import { Injectable, Logger } from '@nestjs/common';
import { File } from '../common/entities/file.entity';
import { S3StorageBackend } from './s3-storage.backend';
import { TelegramStorageBackend } from './telegram-storage.backend';
import {
  StorageBackend,
  StorageConfigError,
  StorageProviderId,
  StorageReadRequest,
  StorageStat,
  StorageStream,
  StorageWriteRequest,
} from './storage.types';

/** 读路径选项：与既有下载链路保持同名参数，便于直接替换调用点。 */
export interface StorageReadOptions {
  expectedSize?: number;
  range?: { start: number; end: number } | null;
  noCache?: boolean;
}

/**
 * 存储路由：按 `files.storageProvider` 把读请求分派到对应后端。
 *
 * 当前版本只接管读路径；写入仍由 Telegram 链路承担（上传选号、账号池、镜像等
 * 都与 Telegram 语义强绑定）。因此 `storageProvider` 为空的存量文件行为不变，
 * 迁移到 S3 的文件可以逐步切读、随时切回。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly backends: Map<StorageProviderId, StorageBackend>;

  constructor(
    telegram: TelegramStorageBackend,
    s3: S3StorageBackend,
  ) {
    this.backends = new Map<StorageProviderId, StorageBackend>([
      ['telegram', telegram],
      ['s3', s3],
    ]);
  }

  /** 该文件应使用的后端标识；空值视为 Telegram（存量数据语义）。 */
  resolveProviderId(file: Pick<File, 'storageProvider'>): StorageProviderId {
    const raw = (file.storageProvider ?? '').trim();
    if (!raw) return 'telegram';
    if (raw !== 'telegram' && raw !== 's3') {
      // 数据里出现未知 provider 属于配置/迁移错误：明确报错而不是猜一个后端
      throw new StorageConfigError(`未知的存储后端：${raw}（files.storageProvider 只允许 telegram / s3）`);
    }
    return raw;
  }

  getBackend(id: StorageProviderId): StorageBackend {
    const backend = this.backends.get(id);
    if (!backend) throw new StorageConfigError(`未注册的存储后端：${id}`);
    return backend;
  }

  /** 读路径入口：按文件记录选择后端并取流。 */
  async openReadStream(
    file: Pick<File, 'storageProvider' | 'storageKey' | 'telegramFileId' | 'filename' | 'originalName'>,
    options: StorageReadOptions = {},
  ): Promise<StorageStream> {
    const providerId = this.resolveProviderId(file);
    const backend = this.getBackend(providerId);

    const key = providerId === 'telegram'
      ? (file.telegramFileId || file.filename || '').trim()
      : (file.storageKey ?? '').trim();

    if (!key) {
      throw new StorageConfigError(
        `文件缺少 ${providerId} 存储定位信息（storageKey / telegramFileId 均为空）`,
      );
    }

    if (!backend.isConfigured()) {
      throw new StorageConfigError(`存储后端 ${providerId} 未配置或配置不完整`);
    }

    const request: StorageReadRequest = {
      key,
      expectedSize: options.expectedSize,
      // Range 只透传给支持原生区间读取的后端；Telegram 的区间由上层 spool 处理
      range: providerId === 's3' ? (options.range ?? null) : null,
      fileName: file.originalName,
      noCache: options.noCache,
    };
    return backend.openRead(request);
  }

  async stat(file: Pick<File, 'storageProvider' | 'storageKey' | 'telegramFileId' | 'filename'>): Promise<StorageStat> {
    const providerId = this.resolveProviderId(file);
    const backend = this.getBackend(providerId);
    const key = providerId === 'telegram'
      ? (file.telegramFileId || file.filename || '').trim()
      : (file.storageKey ?? '').trim();
    if (!key) throw new StorageConfigError(`文件缺少 ${providerId} 存储定位信息`);
    return backend.stat(key);
  }

  /** 该后端是否支持直接写入（当前仅对象存储支持）。 */
  isWritable(id: StorageProviderId): boolean {
    return this.getBackend(id).writable === true;
  }

  /**
   * 写入对象。调用方（上传链路）负责保证：该 provider 支持写入，
   * 且文件记录在同一逻辑事务/补偿范围内，避免「对象写成功但记录没落库」。
   */
  async putObject(id: StorageProviderId, request: StorageWriteRequest): Promise<void> {
    const backend = this.getBackend(id);
    if (!backend.writable || !backend.put) {
      throw new StorageConfigError(`存储后端 ${id} 不支持直接写入`);
    }
    if (!backend.isConfigured()) {
      throw new StorageConfigError(`存储后端 ${id} 未配置或配置不完整`);
    }
    await backend.put(request);
  }

  /** 删除对象；后端不支持写入时视为无操作（Telegram 侧的清理由既有任务承担）。 */
  async deleteObject(id: StorageProviderId, key: string): Promise<void> {
    const backend = this.getBackend(id);
    if (!backend.writable || !backend.deleteObject) return;
    await backend.deleteObject(key);
  }

  /** 启动期自检：把不可用的后端以 warn 暴露出来，而不是等到第一次下载才失败。 */
  logConfigurationStatus(): void {
    for (const [id, backend] of this.backends) {
      if (backend.isConfigured()) continue;
      this.logger.warn(
        `存储后端 ${id} 未配置：配置了该 provider 的文件将无法读取（检查 S3_* 或 Telegram 相关环境变量）`,
      );
    }
  }
}
