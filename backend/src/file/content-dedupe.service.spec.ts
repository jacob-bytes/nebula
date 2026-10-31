import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContentDedupeService } from './content-dedupe.service';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function makeService(options: {
  enabled?: string;
  candidate?: Record<string, unknown> | null;
} = {}) {
  const getOne = jest.fn().mockResolvedValue(options.candidate ?? null);
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne,
  };
  const repository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as never;
  const configService = {
    get: (key: string) => (key === 'UPLOAD_DEDUPE_ENABLED' ? options.enabled : undefined),
  } as never;
  return {
    service: new ContentDedupeService(repository, configService),
    repository: repository as unknown as { update: jest.Mock },
    queryBuilder,
    getOne,
  };
}

const readyCandidate = {
  id: 'existing-file',
  telegramFileId: 'tg-file-id',
  telegramFilePath: 'documents/file.bin',
  telegramMessageId: '42',
  telegramChatId: '-100123',
  telegramFileUniqueId: 'uniq-1',
  telegramSourceAccountId: 'acc-1',
};

describe('ContentDedupeService（上传内容去重）', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dedupe-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('开关', () => {
    it('默认开启', () => {
      expect(makeService().service.isEnabled()).toBe(true);
    });

    it('显式关闭的三种写法都生效', () => {
      for (const value of ['false', '0', 'off']) {
        expect(makeService({ enabled: value }).service.isEnabled()).toBe(false);
      }
    });

    it('关闭时不计算摘要、不查库', async () => {
      const { service, getOne } = makeService({ enabled: 'false', candidate: readyCandidate });
      await expect(service.hashSource({ buffer: Buffer.from('x') })).resolves.toBeNull();
      await expect(service.findReusable({ uploaderId: 'u', contentHash: 'h', size: 1 })).resolves.toBeNull();
      expect(getOne).not.toHaveBeenCalled();
    });
  });

  describe('摘要计算', () => {
    it('Buffer 与磁盘文件得到相同的 sha256', async () => {
      const { service } = makeService();
      const content = 'hello nebula';
      const filePath = join(dir, 'sample.bin');
      writeFileSync(filePath, content);

      await expect(service.hashSource({ buffer: Buffer.from(content) })).resolves.toBe(sha256(content));
      await expect(service.hashSource({ path: filePath })).resolves.toBe(sha256(content));
    });

    it('没有可用内容来源时返回 null（调用方跳过去重而非报错）', async () => {
      const { service } = makeService();
      await expect(service.hashSource({})).resolves.toBeNull();
      await expect(service.hashSource({ path: join(dir, 'missing.bin') })).resolves.toBeNull();
    });
  });

  describe('查找可复用记录', () => {
    it('命中时返回远端定位信息（含来源账号，禁止跨账号复用 file_id）', async () => {
      const { service, queryBuilder } = makeService({ candidate: readyCandidate });
      const reusable = await service.findReusable({ uploaderId: 'u1', contentHash: 'abc', size: 7 });

      expect(reusable).toEqual({
        fileId: 'tg-file-id',
        filePath: 'documents/file.bin',
        messageId: '42',
        chatId: '-100123',
        fileUniqueId: 'uniq-1',
        sourceAccountId: 'acc-1',
        matchedFileId: 'existing-file',
      });
      // 只认 ready + 未删除 + 有非空 file_id
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('file.status = :status', { status: 'ready' });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('file.isDeleted = :isDeleted', { isDeleted: false });
    });

    it('未命中返回 null', async () => {
      const { service } = makeService({ candidate: null });
      await expect(service.findReusable({ uploaderId: 'u1', contentHash: 'abc', size: 7 })).resolves.toBeNull();
    });

    it('排除自身（避免覆盖上传时命中自己）', async () => {
      const { service } = makeService({ candidate: { ...readyCandidate, id: 'self' } });
      await expect(service.findReusable({
        uploaderId: 'u1', contentHash: 'abc', size: 7, excludeFileId: 'self',
      })).resolves.toBeNull();
    });

    it('缺少 uploaderId 或 hash 时不查库', async () => {
      const { service, getOne } = makeService({ candidate: readyCandidate });
      await expect(service.findReusable({ uploaderId: '', contentHash: 'abc', size: 1 })).resolves.toBeNull();
      await expect(service.findReusable({ uploaderId: 'u', contentHash: '', size: 1 })).resolves.toBeNull();
      expect(getOne).not.toHaveBeenCalled();
    });
  });

  describe('摘要落库', () => {
    it('非空摘要写入 files.contentHash', async () => {
      const { service, repository } = makeService();
      await service.rememberHash('file-1', 'abc123');
      expect(repository.update).toHaveBeenCalledWith({ id: 'file-1' }, { contentHash: 'abc123' });
    });

    it('空摘要不写库（存量文件保持 NULL，不参与去重）', async () => {
      const { service, repository } = makeService();
      await service.rememberHash('file-1', null);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('写库失败只告警，不影响上传主流程', async () => {
      const { service, repository } = makeService();
      repository.update.mockRejectedValue(new Error('db down'));
      await expect(service.rememberHash('file-1', 'abc123')).resolves.toBeUndefined();
    });
  });
});
