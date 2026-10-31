import { Readable } from 'stream';
import { S3StorageBackend } from './s3-storage.backend';
import { StorageConfigError } from './storage.types';

/** 最小 ConfigService 替身：只实现 get。 */
function makeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as never;
}

const baseValues = {
  S3_BUCKET: 'nebula',
  S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'https://minio.local:9000',
};

describe('S3StorageBackend（读/写）', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('缺少必填配置时 isConfigured=false，并在调用时报配置错误', async () => {
    const backend = new S3StorageBackend(makeConfig({ S3_BUCKET: 'nebula' }));
    expect(backend.isConfigured()).toBe(false);
    await expect(backend.openRead({ key: 'a' })).rejects.toThrow(StorageConfigError);
  });

  it('自定义 endpoint 默认使用 path-style：/bucket/prefix/key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('hello', { status: 200, headers: { 'content-length': '5' } }),
    );
    global.fetch = fetchMock as never;

    const backend = new S3StorageBackend(makeConfig({ ...baseValues, S3_KEY_PREFIX: 'nebula-prefix' }));
    await backend.openRead({ key: 'dir/a.txt' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://minio.local:9000/nebula/nebula-prefix/dir/a.txt');
  });

  it('无自定义 endpoint 时使用 virtual-hosted-style：bucket 进主机名', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('hello', { status: 200, headers: { 'content-length': '5' } }),
    );
    global.fetch = fetchMock as never;

    const backend = new S3StorageBackend(makeConfig({
      S3_BUCKET: 'nebula',
      S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_REGION: 'ap-east-1',
    }));
    await backend.openRead({ key: 'a.txt' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://nebula.s3.ap-east-1.amazonaws.com/a.txt');
  });

  it('Range 透传为 Range 头，签名覆盖该头', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('abc', {
        status: 206,
        headers: { 'content-length': '3', 'content-range': 'bytes 0-2/100' },
      }),
    );
    global.fetch = fetchMock as never;

    const backend = new S3StorageBackend(makeConfig(baseValues));
    const opened = await backend.openRead({ key: 'a.bin', range: { start: 0, end: 2 } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).range).toBe('bytes=0-2');
    expect((init.headers as Record<string, string>).Authorization).toContain('SignedHeaders=');
    // 有了 Content-Range 就应以对象总大小为准，而不是本次响应长度
    expect(opened.info.file_size).toBe(100);
  });

  it('写入使用 UNSIGNED-PAYLOAD，并以 x-amz-content-sha256 声明', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
    global.fetch = fetchMock as never;

    const backend = new S3StorageBackend(makeConfig(baseValues));
    await backend.put({
      key: 'dir/b.bin',
      body: Buffer.from('payload'),
      size: 7,
      contentType: 'application/octet-stream',
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('PUT');
    expect(headers['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(headers['content-length']).toBe('7');
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers.Authorization).toContain('Credential=AKIAEXAMPLE/');
  });

  it('流式写入声明 duplex: half（Node fetch 的必要条件）', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
    global.fetch = fetchMock as never;

    const backend = new S3StorageBackend(makeConfig(baseValues));
    await backend.put({ key: 'c.bin', body: Readable.from([Buffer.from('x')]), size: 1 });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as { duplex?: string }).duplex).toBe('half');
  });

  it('写入失败抛出带状态码的错误', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('AccessDenied', { status: 403 }),
    ) as never;

    const backend = new S3StorageBackend(makeConfig(baseValues));
    await expect(backend.put({ key: 'd.bin', body: Buffer.from('x') }))
      .rejects.toThrow(/status=403/);
  });

  it('删除幂等：404 视为已删除', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 404 })) as never;
    const backend = new S3StorageBackend(makeConfig(baseValues));
    await expect(backend.deleteObject('missing.bin')).resolves.toBeUndefined();
  });

  it('stat 在 404 时返回 size=null', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 404 })) as never;
    const backend = new S3StorageBackend(makeConfig(baseValues));
    await expect(backend.stat('missing.bin')).resolves.toEqual({ size: null });
  });
});
