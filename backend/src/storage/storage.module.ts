import { Module, OnModuleInit } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { S3StorageBackend } from './s3-storage.backend';
import { TelegramStorageBackend } from './telegram-storage.backend';
import { StorageService } from './storage.service';

@Module({
  imports: [TelegramModule],
  providers: [TelegramStorageBackend, S3StorageBackend, StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly storageService: StorageService) {}

  /** 启动即打印后端配置状态，避免「配了 S3 却漏了密钥」在首次下载时才暴露。 */
  onModuleInit(): void {
    this.storageService.logConfigurationStatus();
  }
}
