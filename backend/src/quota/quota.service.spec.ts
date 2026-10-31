import { HttpStatus } from '@nestjs/common';
import { QuotaService, STORAGE_QUOTA_EXCEEDED } from './quota.service';

const MB = 1024 * 1024;

/** 构造 QuotaService：File 仓库只暴露 SUM 汇总用到的链式 API。 */
function makeService(options: {
  usedBytes?: number;
  quotaColumn?: number | string | null;
  defaultQuotaMb?: string | undefined;
  userExists?: boolean;
} = {}) {
  const {
    usedBytes = 0,
    quotaColumn = null,
    defaultQuotaMb,
    userExists = true,
  } = options;

  const getRawOne = jest.fn().mockResolvedValue({ used: String(usedBytes) });
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne,
  };
  const fileRepository = { createQueryBuilder: jest.fn(() => queryBuilder) } as any;
  // 用可变状态模拟持久化：update 后再 findOne 必须读到新值，否则 setQuota 的
  // 「写入后回读汇总」会被假仓库掩盖成恒为旧值。
  let storedQuota: number | string | null = quotaColumn;
  const userRepository = {
    findOne: jest.fn(async () => (userExists ? { id: 'user-1', storageQuotaBytes: storedQuota } : null)),
    update: jest.fn(async (_criteria: unknown, patch: { storageQuotaBytes?: number | null }) => {
      storedQuota = patch.storageQuotaBytes ?? null;
      return { affected: 1 };
    }),
  } as any;
  const configService = {
    get: jest.fn((key: string) => (key === 'DEFAULT_USER_STORAGE_QUOTA_MB' ? defaultQuotaMb : undefined)),
  } as any;

  return {
    service: new QuotaService(fileRepository, userRepository, configService),
    fileRepository,
    userRepository,
    queryBuilder,
    getRawOne,
  };
}

describe('QuotaService', () => {
  describe('全局默认配额解析', () => {
    it('未配置 / 0 / 非法值 一律视为不限量', () => {
      expect(makeService({ defaultQuotaMb: undefined }).service.getDefaultQuotaBytes()).toBeNull();
      expect(makeService({ defaultQuotaMb: '0' }).service.getDefaultQuotaBytes()).toBeNull();
      expect(makeService({ defaultQuotaMb: 'abc' }).service.getDefaultQuotaBytes()).toBeNull();
      expect(makeService({ defaultQuotaMb: '-5' }).service.getDefaultQuotaBytes()).toBeNull();
    });

    it('正数按 MB 换算为字节', () => {
      expect(makeService({ defaultQuotaMb: '100' }).service.getDefaultQuotaBytes()).toBe(100 * MB);
      expect(makeService({ defaultQuotaMb: '0.5' }).service.getDefaultQuotaBytes()).toBe(Math.floor(0.5 * MB));
    });
  });

  describe('用量汇总', () => {
    it('只统计未删除文件，并把 SUM 的字符串结果收敛为数字', async () => {
      const { service, queryBuilder, getRawOne } = makeService({ usedBytes: 1234 });
      await expect(service.getUsedBytes('user-1')).resolves.toBe(1234);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('file.isDeleted = :isDeleted', { isDeleted: false });
      expect(getRawOne).toHaveBeenCalled();
    });

    it('SUM 为空时回退 0，避免 NaN 参与比较', async () => {
      const { service, getRawOne } = makeService();
      getRawOne.mockResolvedValue({ used: null });
      await expect(service.getUsedBytes('user-1')).resolves.toBe(0);
    });
  });

  describe('配额解析（users.storageQuotaBytes 三态）', () => {
    it('NULL → 继承全局默认', async () => {
      const { service } = makeService({ quotaColumn: null, defaultQuotaMb: '10' });
      await expect(service.resolveQuotaBytes('user-1')).resolves.toBe(10 * MB);
    });

    it('0 → 该用户明确不限量（覆盖全局默认）', async () => {
      const { service } = makeService({ quotaColumn: 0, defaultQuotaMb: '10' });
      await expect(service.resolveQuotaBytes('user-1')).resolves.toBeNull();
    });

    it('正数（PostgreSQL bigint 以字符串返回）→ 直接作为字节上限', async () => {
      const { service } = makeService({ quotaColumn: '5242880', defaultQuotaMb: '10' });
      await expect(service.resolveQuotaBytes('user-1')).resolves.toBe(5 * MB);
    });

    it('用户不存在时退回全局默认，避免查询异常导致上传被永久拒绝', async () => {
      const { service } = makeService({ userExists: false, defaultQuotaMb: '10' });
      await expect(service.resolveQuotaBytes('missing')).resolves.toBe(10 * MB);
    });
  });

  describe('上传校验', () => {
    it('不限量时不查询用量（省一次聚合）', async () => {
      const { service, fileRepository } = makeService({ quotaColumn: 0 });
      await expect(service.assertCanUpload('user-1', 10 * MB)).resolves.toBeUndefined();
      expect(fileRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('未超限放行', async () => {
      const { service } = makeService({ quotaColumn: 10 * MB, usedBytes: 9 * MB });
      await expect(service.assertCanUpload('user-1', 1 * MB)).resolves.toBeUndefined();
    });

    it('恰好等于上限放行（边界不应误杀）', async () => {
      const { service } = makeService({ quotaColumn: 10 * MB, usedBytes: 9 * MB });
      await expect(service.assertCanUpload('user-1', 1 * MB)).resolves.toBeUndefined();
    });

    it('超限时抛 413 + 业务码，并带上用量明细供前端展示', async () => {
      const { service } = makeService({ quotaColumn: 10 * MB, usedBytes: 9 * MB });
      await expect(service.assertCanUpload('user-1', 2 * MB)).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        response: {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          code: STORAGE_QUOTA_EXCEEDED,
          errorCode: STORAGE_QUOTA_EXCEEDED,
          usedBytes: 9 * MB,
          quotaBytes: 10 * MB,
          requiredBytes: 2 * MB,
        },
      });
    });

    it('异常入参不参与计算（NaN / 负数视为 0）', async () => {
      const { service } = makeService({ quotaColumn: 10 * MB, usedBytes: 10 * MB });
      await expect(service.assertCanUpload('user-1', Number.NaN)).resolves.toBeUndefined();
      await expect(service.assertCanUpload('user-1', -1)).resolves.toBeUndefined();
    });

    it('批量校验按总大小一次性判断', async () => {
      const { service, fileRepository } = makeService({ quotaColumn: 10 * MB, usedBytes: 5 * MB });
      await expect(service.assertCanUploadTotal('user-1', [3 * MB, 2 * MB])).resolves.toBeUndefined();
      // 单次校验只做一次汇总查询
      expect(fileRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      await expect(service.assertCanUploadTotal('user-1', [3 * MB, 3 * MB])).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      });
    });
  });

  describe('管理员设置配额', () => {
    it('写入 users.storageQuotaBytes 并返回最新汇总', async () => {
      const { service, userRepository } = makeService({ quotaColumn: 0, usedBytes: 2048 });
      const summary = await service.setQuota('user-1', 7 * MB);
      expect(userRepository.update).toHaveBeenCalledWith({ id: 'user-1' }, { storageQuotaBytes: 7 * MB });
      expect(summary.quotaBytes).toBe(7 * MB);
      expect(summary.remainingBytes).toBe(7 * MB - 2048);
      expect(summary.unlimited).toBe(false);
    });

    it('传 null 恢复继承全局默认', async () => {
      const { service, userRepository } = makeService({ quotaColumn: 5 * MB });
      await service.setQuota('user-1', null);
      expect(userRepository.update).toHaveBeenCalledWith({ id: 'user-1' }, { storageQuotaBytes: null });
    });

    describe('批量设置', () => {
      it('去重并过滤空 id 后单条更新', async () => {
        const { service, userRepository } = makeService();
        userRepository.update.mockResolvedValue({ affected: 2 });
        const result = await service.setQuotaBatch(['u1', 'u1', '  u2  ', ''], 3 * MB);

        expect(userRepository.update).toHaveBeenCalledTimes(1);
        const [criteria] = userRepository.update.mock.calls[0];
        // TypeORM 的 In(...) 包装成 FindOperator，这里只断言参与更新的 id 集合
        expect(JSON.stringify(criteria)).toContain('u1');
        expect(JSON.stringify(criteria)).toContain('u2');
        expect(result).toEqual({ requested: 2, updated: 2, missing: 0 });
      });

      it('affected 少于请求数时报告缺失数量', async () => {
        const { service, userRepository } = makeService();
        userRepository.update.mockResolvedValue({ affected: 1 });
        const result = await service.setQuotaBatch(['u1', 'u2'], 0);
        expect(result).toEqual({ requested: 2, updated: 1, missing: 1 });
      });

      it('空列表不发更新请求', async () => {
        const { service, userRepository } = makeService();
        const result = await service.setQuotaBatch([], 5 * MB);
        expect(userRepository.update).not.toHaveBeenCalled();
        expect(result).toEqual({ requested: 0, updated: 0, missing: 0 });
      });

      it('null 表示批量恢复全局默认', async () => {
        const { service, userRepository } = makeService();
        await service.setQuotaBatch(['u1'], null);
        expect(userRepository.update).toHaveBeenCalledWith(
          expect.anything(),
          { storageQuotaBytes: null },
        );
      });
    });
  });
});
