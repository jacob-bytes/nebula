import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { createDatabaseOptions } from './database/database.config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { FileModule } from './file/file.module';
import { FolderModule } from './folder/folder.module';
import { ShareModule } from './share/share.module';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './config/config.module';
import { TasksModule } from './tasks/tasks.module';
import { ConfigCacheModule } from './common/services/config-cache.module';
import { RateLimitModule } from './common/services/rate-limit.module';
import { AuditModule } from './common/services/audit.module';
import { DirectoryNamespaceModule } from './common/services/directory-namespace.module';
import { StreamResponderModule } from './common/services/stream-responder.module';
import { AccessLogModule } from './common/access-log.module';
import { JobsModule } from './jobs/jobs.module';
import { AlertModule } from './alert/alert.module';
import { TelegramModule } from './telegram/telegram.module';
import { SecurityModule } from './security/security.module';
import { SetupModule } from './setup/setup.module';
import { APP_GUARD } from '@nestjs/core';
import { GuardRequirementGuard } from './common/guards/guard-requirement.guard';
import { TagModule } from './tag/tag.module';
import { PublicConfigModule } from './public-config/public-config.module';
import { HealthModule } from './health/health.module';
import { VersionModule } from './version/version.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { QuotaModule } from './quota/quota.module';
import { TelegramAccountPoolModule } from './telegram-account-pool/telegram-account-pool.module';
import { TelegramAccountsModule } from './telegram-accounts/telegram-accounts.module';
import { TelegramMirrorModule } from './telegram-mirror/telegram-mirror.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(createDatabaseOptions()),
    AuthModule,
    UserModule,
    FileModule,
    FolderModule,
    ShareModule,
    AdminModule,
    AppConfigModule,
    TasksModule,
    ConfigCacheModule,
    RateLimitModule,
    AuditModule,
    DirectoryNamespaceModule,
    StreamResponderModule,
    AccessLogModule,
    JobsModule,
    AlertModule,
    SecurityModule,
    SetupModule,
    TagModule,
    PublicConfigModule,
    HealthModule,
    VersionModule,
    QuotaModule,
    TelegramModule,
    ApiKeyModule,
    TelegramBotModule,
    TelegramAccountPoolModule,
    // 账号池后台管理（账号 CRUD、凭据加密托管、三层开关）与镜像规则/任务
    TelegramAccountsModule,
    TelegramMirrorModule,
  ],
  providers: [
    // 全局 fail-closed：路由必须自带鉴权守卫或显式 @Public()，否则拒绝。
    // 不改变既有路由行为（它们都带守卫），只拦住"新增控制器忘记加锁"。
    { provide: APP_GUARD, useClass: GuardRequirementGuard },
  ],
})
export class AppModule {}
