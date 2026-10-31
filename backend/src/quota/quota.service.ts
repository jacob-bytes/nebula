import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { File } from '../common/entities/file.entity';
import { User } from '../common/entities/user.entity';

/** 配额超限的业务码：前端据此展示专门的提示，而不是通用的「上传失败」。 */
export const STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED';

export interface StorageQuotaSummary {
  /** 当前已占用字节数（只统计未删除的文件） */
  usedBytes: number;
  /** 生效的配额字节数；null 表示不限 */
  quotaBytes: number | null;
  /** 剩余可用字节数；不限时为 null */
  remainingBytes: number | null;
  /** 是否不限量 */
  unlimited: boolean;
}

/**
 * 用户存储配额。
 *
 * 设计取舍：用量不维护冗余计数器，而是对 `files` 表按用户实时 `SUM(size)`。
 * 原因是上传存在多条路径（同步 / 异步 / 分片 / Bot 直链 / 文件复制 / 覆盖上传），
 * 计数器需要在每处增减且失败回滚时容易漂移；汇总查询走
 * `idx_files_uploader_folder_deleted` 的前缀列，单用户量级下代价可接受。
 *
 * 配额语义（`users.storageQuotaBytes`）：
 *   null → 继承全局默认 `DEFAULT_USER_STORAGE_QUOTA_MB`（0 表示不限）
 *   0    → 明确不限
 *   >0   → 该用户活跃文件总字节上限
 *
 * 口径说明：只统计 `isDeleted = false` 的文件。软删除（7 天冷静期）期间不计入占用，
 * 与实际「用户可见的可用容量」一致；存储侧真正释放由清理任务负责。
 */
@Injectable()
export class QuotaService {
  constructor(
    @InjectRepository(File) private readonly fileRepository: Repository<File>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  /** 全局默认配额（字节）；返回 null 表示不限。 */
  getDefaultQuotaBytes(): number | null {
    const raw = this.configService.get<string>('DEFAULT_USER_STORAGE_QUOTA_MB');
    const megabytes = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(megabytes) || megabytes <= 0) {
      return null;
    }
    return Math.floor(megabytes * 1024 * 1024);
  }

  /** 统计用户已占用字节数（未删除文件）。 */
  async getUsedBytes(userId: string): Promise<number> {
    const row = await this.fileRepository
      .createQueryBuilder('file')
      .select('COALESCE(SUM(file.size), 0)', 'used')
      .where('file.uploaderId = :userId', { userId })
      .andWhere('file.isDeleted = :isDeleted', { isDeleted: false })
      .getRawOne<{ used: string | number | null }>();
    const used = Number(row?.used ?? 0);
    return Number.isFinite(used) ? used : 0;
  }

  /** 解析用户实际生效的配额；null 表示不限。 */
  async resolveQuotaBytes(userId: string): Promise<number | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'storageQuotaBytes'],
    });
    if (!user) return this.getDefaultQuotaBytes();

    const configured = user.storageQuotaBytes;
    // bigint 在 PostgreSQL 驱动里以字符串返回，这里统一收敛为数字
    if (configured === null || configured === undefined) return this.getDefaultQuotaBytes();
    const quota = Number(configured);
    if (!Number.isFinite(quota) || quota < 0) return this.getDefaultQuotaBytes();
    return quota === 0 ? null : Math.floor(quota);
  }

  async getSummary(userId: string): Promise<StorageQuotaSummary> {
    const [usedBytes, quotaBytes] = await Promise.all([
      this.getUsedBytes(userId),
      this.resolveQuotaBytes(userId),
    ]);
    return {
      usedBytes,
      quotaBytes,
      remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes),
      unlimited: quotaBytes === null,
    };
  }

  /**
   * 上传前校验。超限时抛出 413 + 业务码，交由全局过滤器透传
   * `X-Nebula-Error-Code` 与结构化响应体。
   */
  async assertCanUpload(userId: string, incomingBytes: number): Promise<void> {
    const quotaBytes = await this.resolveQuotaBytes(userId);
    if (quotaBytes === null) return;

    const usedBytes = await this.getUsedBytes(userId);
    // 非负有限数才参与计算，避免异常入参把校验变成恒真
    const incoming = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
    if (usedBytes + incoming <= quotaBytes) return;

    throw new HttpException(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: STORAGE_QUOTA_EXCEEDED,
        errorCode: STORAGE_QUOTA_EXCEEDED,
        message: this.buildExceededMessage(usedBytes, quotaBytes, incoming),
        usedBytes,
        quotaBytes,
        requiredBytes: incoming,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  /** 批量上传：按总大小一次性校验，避免逐个文件各查一次汇总。 */
  async assertCanUploadTotal(userId: string, incomingBytesList: number[]): Promise<void> {
    const total = incomingBytesList.reduce(
      (sum, size) => sum + (Number.isFinite(size) && size > 0 ? size : 0),
      0,
    );
    await this.assertCanUpload(userId, total);
  }

  /**
   * 批量设置配额。
   *
   * 用于运营侧「按批次统一调整」（例如给一批用户临时扩容）。
   * 用单条 `IN (...)` 更新而不是逐个 update：既减少往返，也避免部分成功时无法判断进度。
   * 返回值区分「请求里重复的 id」与「库里不存在的 id」，便于后台如实提示。
   */
  async setQuotaBatch(
    userIds: string[],
    quotaBytes: number | null,
  ): Promise<{ requested: number; updated: number; missing: number }> {
    const unique = Array.from(new Set((userIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (unique.length === 0) return { requested: 0, updated: 0, missing: 0 };

    const result = await this.userRepository.update(
      { id: In(unique) },
      { storageQuotaBytes: quotaBytes },
    );
    const updated = Number(result?.affected ?? 0);
    return {
      requested: unique.length,
      updated,
      // affected 少于请求数说明有 id 不存在（或已被软删除过滤）
      missing: Math.max(0, unique.length - updated),
    };
  }

  /** 管理员设置配额；null 表示恢复为继承全局默认。 */
  async setQuota(userId: string, quotaBytes: number | null): Promise<StorageQuotaSummary> {
    await this.userRepository.update({ id: userId }, { storageQuotaBytes: quotaBytes });
    return this.getSummary(userId);
  }

  private buildExceededMessage(usedBytes: number, quotaBytes: number, incomingBytes: number): string {
    const format = (bytes: number) => {
      if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
      if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    };
    const detail = `已用 ${format(usedBytes)} / 上限 ${format(quotaBytes)}，本次需要 ${format(incomingBytes)}`;
    return `存储配额不足（${detail}）。请删除文件释放空间或联系管理员调整配额。`;
  }
}
