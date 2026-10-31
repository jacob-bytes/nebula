import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { Repository } from 'typeorm';
import { File } from '../common/entities/file.entity';

/** 去重命中时供调用方复用的远端定位信息。 */
export interface ReusableContent {
  fileId: string;
  filePath: string;
  messageId: string | null;
  chatId: string | null;
  fileUniqueId: string | null;
  sourceAccountId: string | null;
  /** 命中的原文件 id，用于日志与审计 */
  matchedFileId: string;
}

/**
 * 上传内容去重。
 *
 * 动机：本系统把文件本体存在 Telegram，**上传字节是单向且不可逆的成本**。
 * 文件分发场景里同一份内容被反复上传（同一用户重传、批量补传、覆盖上传失败重试），
 * 每次都完整走一遍 Telegram 上行。对内容做 sha256 后复用已有 `file_id`，
 * 可把这类重复上行降为 0。
 *
 * 安全边界（有意收紧）：
 * - **只在同一 uploaderId 内复用**。跨用户去重能省更多，但会让「某人上传后另一个人
 *   立即命中」成为可观测的侧信道（时序/配额差异），需要先设计配额与生命周期语义。
 * - 只复用 `status='ready'`、未删除、且确实持有 `telegramFileId` 的记录；
 *   processing / error / 已软删的记录一律不作为来源。
 * - 不做跨账号复用：`file_id` 与上传时使用的 Bot 账号绑定，命中方沿用来源账号字段，
 *   否则后续下载会拿错账号的引用。
 *
 * 存储侧影响：复用不复制任何字节，两条记录共享同一个 Telegram 对象。
 * 这与既有「删除文件不删远端对象、引用副本可能共享远端对象」的设计一致。
 */
@Injectable()
export class ContentDedupeService {
  private readonly logger = new Logger(ContentDedupeService.name);

  constructor(
    @InjectRepository(File) private readonly fileRepository: Repository<File>,
    private readonly configService: ConfigService,
  ) {}

  /** 去重总开关，默认开启；关闭时完全退回改造前行为。 */
  isEnabled(): boolean {
    const raw = (this.configService.get<string>('UPLOAD_DEDUPE_ENABLED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off';
  }

  /**
   * 计算内容摘要。优先用磁盘路径（大文件不占内存），否则用已接收的 Buffer。
   * 返回 null 表示没有可用的内容来源（调用方应跳过去重而不是报错）。
   */
  async hashSource(source: { path?: string; buffer?: Buffer }): Promise<string | null> {
    if (!this.isEnabled()) return null;

    if (source.path && existsSync(source.path)) {
      return new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(source.path as string);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
      });
    }
    if (source.buffer && source.buffer.length >= 0) {
      return createHash('sha256').update(source.buffer).digest('hex');
    }
    return null;
  }

  /**
   * 查找可复用的同内容文件。
   *
   * 必须有相同大小：sha256 碰撞虽不可行，但大小一致能让查询走
   * `idx_files_uploader_hash` 之后再做一次廉价过滤，也避免「哈希写错」时误命中。
   */
  async findReusable(params: {
    uploaderId: string;
    contentHash: string;
    size: number;
    excludeFileId?: string;
  }): Promise<ReusableContent | null> {
    if (!this.isEnabled()) return null;
    const { uploaderId, contentHash, size, excludeFileId } = params;
    if (!uploaderId || !contentHash) return null;

    const candidate = await this.fileRepository
      .createQueryBuilder('file')
      .where('file.uploaderId = :uploaderId', { uploaderId })
      .andWhere('file.contentHash = :contentHash', { contentHash })
      .andWhere('file.size = :size', { size })
      .andWhere('file.status = :status', { status: 'ready' })
      .andWhere('file.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('file.telegramFileId IS NOT NULL AND file.telegramFileId <> :empty', { empty: '' })
      .orderBy('file.createdAt', 'ASC')
      .limit(1)
      .getOne();

    if (!candidate) return null;
    if (excludeFileId && candidate.id === excludeFileId) return null;

    this.logger.log(
      `内容去重复用：uploader=${uploaderId} hash=${contentHash.slice(0, 12)}… 命中 file=${candidate.id}`,
    );
    return {
      fileId: candidate.telegramFileId,
      filePath: candidate.telegramFilePath || '',
      messageId: candidate.telegramMessageId ?? null,
      chatId: candidate.telegramChatId ?? null,
      fileUniqueId: candidate.telegramFileUniqueId ?? null,
      sourceAccountId: candidate.telegramSourceAccountId ?? null,
      matchedFileId: candidate.id,
    };
  }

  /** 记录内容摘要；失败只记日志，不影响上传主流程。 */
  async rememberHash(fileId: string, contentHash: string | null): Promise<void> {
    if (!contentHash) return;
    try {
      await this.fileRepository.update({ id: fileId }, { contentHash });
    } catch (error: unknown) {
      this.logger.warn(
        `写入内容摘要失败 file=${fileId}：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
