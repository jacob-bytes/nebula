import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SetupService } from './setup.service';

class TestTelegramDto {
  @IsString() @MinLength(1) setupToken!: string;
  @IsString() @MinLength(1) botToken!: string;
  // 可选：不传则只做 getMe 检查，不发送消息
  @IsOptional() @IsString() chatId?: string;
}

class CompleteSetupDto {
  @IsString() @MinLength(1) setupToken!: string;
  @IsString() @MaxLength(60) siteTitle!: string;
  @IsString() @MinLength(1) appUrl!: string;
  @IsString() @MinLength(1) telegramBotToken!: string;
  @IsString() @MinLength(1) telegramChatId!: string;
  @IsString() @MinLength(1) adminEmail!: string;
  @IsString() @MinLength(8) adminPassword!: string;
}

/**
 * 首次运行向导接口（公开）。
 *
 * 全部写操作都要求一次性 setup token（安装脚本生成、仅服务用户可读的文件）。
 * 完成后向导接口因「已初始化」而永久拒绝，且 token 文件被删除。
 * 这里不挂 JwtAuthGuard：此时还没有任何账号；但也不意味着无防护——见 setupToken 校验。
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /** 向导页启动时调用：判断是否显示向导、是否需要令牌 */
  @Get('status')
  async status() {
    return this.setupService.getStatus();
  }

  /** Telegram 连通性自检：getMe + 可选发送测试消息 */
  @Post('test-telegram')
  async testTelegram(@Body() dto: TestTelegramDto) {
    this.setupService.assertToken(dto.setupToken);
    return this.setupService.testTelegram(dto.botToken, dto.chatId);
  }

  /** 完成向导：创建管理员 + 写入 .env + 关闭向导 */
  @Post('complete')
  async complete(@Body() dto: CompleteSetupDto, @Req() _req: Request) {
    return this.setupService.complete(dto);
  }
}
