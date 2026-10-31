import { Readable } from 'stream';
import { StorageService } from './storage.service';
import { StorageConfigError } from './storage.types';

function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

/** 构造一个最小可用的假后端；configured 控制 isConfigured() 结果。 */
/** File 在服务里只按 Pick 使用；spec 用宽松字面量构造，避免为满足实体全部字段写样板。 */
function fileOf(overrides: {
  storageProvider?: string | null;
  storageKey?: string | null;
  telegramFileId?: string | null;
  filename?: string;
  originalName?: string;
}): never {
  return {
    storageProvider: overrides.storageProvider ?? null,
    storageKey: overrides.storageKey ?? null,
    telegramFileId: overrides.telegramFileId ?? null,
    filename: overrides.filename ?? '',
    originalName: overrides.originalName ?? '',
  } as never;
}

function makeBackend(id: 'telegram' | 's3', configured = true) {
  return {
    id,
    isConfigured: jest.fn(() => configured),
    openRead: jest.fn(async (request: { key: string; range?: unknown }) => ({
      stream: streamOf('payload'),
      info: { file_id: request.key, file_path: '', file_size: 7 },
    })),
    stat: jest.fn(async () => ({ size: 7 })),
  };
}

function makeService(options: { s3Configured?: boolean; telegramConfigured?: boolean } = {}) {
  const telegram = makeBackend('telegram', options.telegramConfigured ?? true);
  const s3 = makeBackend('s3', options.s3Configured ?? true);
  const service = new StorageService(telegram as never, s3 as never);
  return { service, telegram, s3 };
}

describe('StorageService（存储路由）', () => {
  describe('provider 解析', () => {
    it('空值视为 Telegram（存量数据语义）', () => {
      const { service } = makeService();
      expect(service.resolveProviderId({ storageProvider: null })).toBe('telegram');
      expect(service.resolveProviderId({ storageProvider: '' })).toBe('telegram');
      expect(service.resolveProviderId({ storageProvider: '   ' })).toBe('telegram');
    });

    it('显式 provider 原样识别', () => {
      const { service } = makeService();
      expect(service.resolveProviderId({ storageProvider: 'telegram' })).toBe('telegram');
      expect(service.resolveProviderId({ storageProvider: 's3' })).toBe('s3');
    });

    it('未知 provider 明确报错，而不是猜一个后端', () => {
      const { service } = makeService();
      expect(() => service.resolveProviderId({ storageProvider: 'oss' }))
        .toThrow(StorageConfigError);
    });
  });

  describe('读路径分派', () => {
    it('Telegram 文件用 telegramFileId 取流，且不向上游透传 Range', async () => {
      const { service, telegram, s3 } = makeService();
      const result = await service.openReadStream(
        fileOf({ storageProvider: null, telegramFileId: 'file-abc', filename: 'x.bin', originalName: 'x.bin' }),
        { expectedSize: 7, range: { start: 0, end: 6 } },
      );
      expect(result.info.file_id).toBe('file-abc');
      expect(telegram.openRead).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'file-abc', expectedSize: 7, range: null }),
      );
      expect(s3.openRead).not.toHaveBeenCalled();
    });

    it('S3 文件用 storageKey 取流，并透传原生 Range', async () => {
      const { service, telegram, s3 } = makeService();
      const result = await service.openReadStream(
        fileOf({ storageProvider: 's3', storageKey: 'nebula/a.bin', filename: 'a.bin', originalName: 'a.bin' }),
        { expectedSize: 10, range: { start: 2, end: 5 } },
      );
      expect(result.info.file_id).toBe('nebula/a.bin');
      expect(s3.openRead).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'nebula/a.bin', range: { start: 2, end: 5 } }),
      );
      expect(telegram.openRead).not.toHaveBeenCalled();
    });

    it('定位信息为空时报配置错误（避免静默拿到错误对象）', async () => {
      const { service } = makeService();
      await expect(service.openReadStream(
        fileOf({ storageProvider: 's3' }),
      )).rejects.toThrow(StorageConfigError);
    });

    it('后端未配置时报配置错误', async () => {
      const { service } = makeService({ s3Configured: false });
      await expect(service.openReadStream(
        fileOf({ storageProvider: 's3', storageKey: 'k' }),
      )).rejects.toThrow(StorageConfigError);
    });
  });

  describe('stat 与配置自检', () => {
    it('stat 按同一规则分派', async () => {
      const { service, s3 } = makeService();
      await expect(service.stat(fileOf({ storageProvider: 's3', storageKey: 'k' })))
        .resolves.toEqual({ size: 7 });
      expect(s3.stat).toHaveBeenCalledWith('k');
    });

    it('logConfigurationStatus 只对未配置的后端告警', () => {
      const { service } = makeService({ s3Configured: false });
      const logger = (service as unknown as { logger: { warn: (message: string) => void } }).logger;
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      service.logConfigurationStatus();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String((warn as jest.Mock).mock.calls[0][0])).toContain('s3');
    });
  });
});
