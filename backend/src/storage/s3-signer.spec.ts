import { EMPTY_PAYLOAD_SHA256, signRequest, toAmzDate } from './s3-signer';

/**
 * SigV4 单测使用 AWS 官方文档的 GET Object 示例作为已知向量。
 *
 * 来源：AWS S3 文档 "Authenticating Requests: Using the Authorization Header"
 * 中的 Example: GET Object。凭证为文档公开的示例凭证，与任何真实账号无关。
 */
describe('S3 SigV4 签名器', () => {
  const credentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };

  it('与 AWS 官方文档的 GET Object 示例签名一致', () => {
    const result = signRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      amzDate: '20130524T000000Z',
      region: 'us-east-1',
      service: 's3',
      ...credentials,
    });

    expect(result.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_PAYLOAD_SHA256,
      ].join('\n'),
    );
    expect(result.scope).toBe('20130524/us-east-1/s3/aws4_request');
    expect(result.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(result.authorization).toContain(`Credential=AKIAIOSFODNN7EXAMPLE/${result.scope}`);
    expect(result.authorization).toContain(
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date',
    );
  });

  it('路径按段编码，密钥中的空格与中文不会原样进入签名', () => {
    const result = signRequest({
      method: 'GET',
      host: 'minio.local:9000',
      path: '/nebula/照片 2026/报告 v2.pdf',
      headers: { host: 'minio.local:9000', 'x-amz-date': '20261031T120000Z' },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      amzDate: '20261031T120000Z',
      region: 'us-east-1',
      service: 's3',
      ...credentials,
    });
    // 保留 '/' 分隔，其余字符编码为 %XX 大写
    expect(result.canonicalRequest.split('\n')[1]).toBe(
      '/nebula/%E7%85%A7%E7%89%87%202026/%E6%8A%A5%E5%91%8A%20v2.pdf',
    );
  });

  it('查询参数按字典序参与签名', () => {
    const result = signRequest({
      method: 'GET',
      host: 's3.example.com',
      path: '/bucket',
      query: { prefix: 'a b', 'list-type': '2' },
      headers: { host: 's3.example.com', 'x-amz-date': '20261031T120000Z' },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      amzDate: '20261031T120000Z',
      region: 'us-east-1',
      service: 's3',
      ...credentials,
    });
    expect(result.canonicalRequest.split('\n')[2]).toBe('list-type=2&prefix=a%20b');
  });

  it('头名大小写与多余空白不影响签名结果', () => {
    const base = {
      method: 'GET',
      host: 's3.example.com',
      path: '/bucket/key',
      payloadHash: EMPTY_PAYLOAD_SHA256,
      amzDate: '20261031T120000Z',
      region: 'us-east-1',
      service: 's3',
      ...credentials,
    } as const;
    const normalized = signRequest({ ...base, headers: { host: 's3.example.com' } });
    const noisy = signRequest({ ...base, headers: { Host: '  s3.example.com  ' } });
    expect(noisy.signature).toBe(normalized.signature);
  });

  it('toAmzDate 输出 YYYYMMDDTHHMMSSZ', () => {
    expect(toAmzDate(new Date('2026-10-31T12:00:00Z'))).toBe('20261031T120000Z');
  });
});
