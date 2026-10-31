import type { Readable } from 'stream';

/** 支持的存储后端标识，与 `files.storageProvider` 列取值一致。 */
export type StorageProviderId = 'telegram' | 's3';

/** 一次读请求。key 的语义由后端决定：Telegram 为 file_id，S3 为 object key。 */
export interface StorageReadRequest {
  key: string;
  /** 期望的文件大小；用于上游提示与一致性校验 */
  expectedSize?: number;
  /** 闭区间字节范围。仅 S3 原生支持；Telegram 的 Range 由上层缓存/spool 层实现 */
  range?: { start: number; end: number } | null;
  /** 仅用于日志与 S3 的 Content-Disposition，不参与寻址 */
  fileName?: string;
  /** Telegram 专用：跳过其本地缓存（与既有 noCache 语义一致） */
  noCache?: boolean;
}

/**
 * 读流结果。
 *
 * `info` 保持既有 Telegram 形态，使上层（缓存、Range、访问日志）无需分支即可消费；
 * 非 Telegram 后端把 key 填入 file_id、空字符串填入 file_path。
 */
export interface StorageStream {
  stream: Readable;
  info: { file_id: string; file_path: string; file_size: number };
}

export interface StorageStat {
  size: number | null;
}

/**
 * 存储后端端口（port）。
 *
 * 只声明读路径所需能力：当前版本写入仍由 Telegram 链路承担，
 * 抽象先解除「读只能来自 Telegram」的耦合，后续可增量补 put/delete。
 */
export interface StorageBackend {
  readonly id: StorageProviderId;
  /** 配置是否完整可用；不可用时上层应回退或报明确的配置错误 */
  isConfigured(): boolean;
  openRead(request: StorageReadRequest): Promise<StorageStream>;
  stat(key: string): Promise<StorageStat>;
}

/** 配置错误：让「配错了」与「对象不存在」在日志和响应里可区分。 */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}
