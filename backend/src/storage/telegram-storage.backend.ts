import { Injectable } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service';
import { StorageBackend, StorageReadRequest, StorageStat, StorageStream } from './storage.types';

/**
 * Telegram 存储后端：把既有的 Telegram 取流能力适配到 StorageBackend 端口。
 *
 * 语义保持原样：Range 不在这里实现——Telegram 的实时流是顺序字节流，
 * 断点续传由上层缓存 / spool 层按区间截取（见 docs/download-and-cache.md）。
 * `range` 传入时忽略，由调用方保证不走这条路径去要求原生 seek。
 */
@Injectable()
export class TelegramStorageBackend implements StorageBackend {
  readonly id = 'telegram' as const;

  constructor(private readonly telegramService: TelegramService) {}

  /**
   * 不可直接写入：上传由既有链路（账号池选号 / 镜像 / 副本扩散）承担。
   * 在这条链路外再造一套 put 会复制全部 Telegram 语义，因此端口上直接声明能力边界。
   */
  readonly writable = false;

  isConfigured(): boolean {
    // Telegram 后端的可用性由 Bot Token 决定，启动校验已覆盖；此处不做二次判断
    return true;
  }

  async openRead(request: StorageReadRequest): Promise<StorageStream> {
    const stream = await this.telegramService.getRealtimeFileStream(
      request.key,
      request.expectedSize,
      { noCache: request.noCache },
    );
    return { stream: stream.stream, info: stream.info };
  }

  async stat(key: string): Promise<StorageStat> {
    const info = await this.telegramService.verifyFileExists(key);
    return { size: Number.isFinite(info.file_size) ? info.file_size : null };
  }
}
