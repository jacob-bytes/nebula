import { Body, Controller, Get, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { SetupService } from './setup.service';
import { RateLimitService } from '../common/services/rate-limit.service';

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
@Public()
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setupService: SetupService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * 向导接口限流（按 IP）。
   *
   * 虽然爆破 192 位令牌不现实，但未初始化的实例是公开可访问的：
   * 不限流的话，`test-telegram` 可以被反复调用来让服务器外呼 Telegram（放大攻击）。
   */
  private async assertRateLimit(req: Request, action: string): Promise<void> {
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown').toString();
    const result = await this.rateLimitService.checkAndIncrement(
      `setup:${action}:${ip}`,
      'setup',
      10,          // 10 次
      5 * 60_000,  // 触发后锁定 5 分钟
      5 * 60_000,  // 5 分钟滑动窗口
    );
    if (!result.allowed) {
      throw new HttpException('请求过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** 向导页启动时调用：判断是否显示向导、是否需要令牌 */
  @Get('status')
  async status() {
    return this.setupService.getStatus();
  }

  /** Telegram 连通性自检：getMe + 可选发送测试消息 */
  @Post('test-telegram')
  async testTelegram(@Body() dto: TestTelegramDto, @Req() req: Request) {
    await this.assertRateLimit(req, 'test-telegram');
    this.setupService.assertToken(dto.setupToken);
    return this.setupService.testTelegram(dto.botToken, dto.chatId);
  }

  /** 完成向导：创建管理员 + 写入 .env + 关闭向导 */
  @Post('complete')
  async complete(@Body() dto: CompleteSetupDto, @Req() req: Request) {
    await this.assertRateLimit(req, 'complete');
    return this.setupService.complete(dto);
  }
}
