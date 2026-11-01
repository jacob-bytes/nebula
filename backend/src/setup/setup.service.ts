import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from '../common/entities/user.entity';

export interface SetupStatus {
  /** 是否已初始化（存在任意用户即视为已完成） */
  initialized: boolean;
  /** 是否处于向导模式（安装时未提供 Telegram 凭据） */
  setupMode: boolean;
  /** 向导是否可用：未初始化 且 提供了可用的 setup token */
  available: boolean;
  /** 站点标题（已完成时用于落地页展示，未完成时为默认值） */
  siteTitle: string;
}

export interface CompleteSetupInput {
  setupToken: string;
  setupTokenFile?: string;
  siteTitle: string;
  appUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  adminEmail: string;
  adminPassword: string;
}

/**
 * 首次运行向导（/setup）的后端支持。
 *
 * 安全模型（与安装脚本配合）：
 * - 安装脚本生成一次性 setup token，写入仅 root/service 用户可读的文件，并打印在终端；
 * - 向导的每个写操作都必须带上该 token；完成后删除文件并清除 .env 里的 SETUP_MODE，
 *   向导接口随之永久失效；
 * - 未初始化 + 公网暴露 = 任何人都能抢先设置管理员，所以 token 是硬性要求。
 *
 * 生效方式：完成后把配置写进 .env，然后让进程退出，由 systemd 的 Restart=always
 * 拉起（避免在进程内热替换 Telegram 客户端带来的状态不一致）。
 */
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  /** 是否处于向导模式（安装时未提供 Telegram 凭据） */
  isSetupMode(): boolean {
    return (this.configService.get<string>('SETUP_MODE') ?? '').trim().toLowerCase() === 'true';
  }

  /** 用户表为空即未初始化；与「首次注册成为超管」共用同一个判定口径 */
  async isInitialized(): Promise<boolean> {
    const count = await this.userRepo.count();
    return count > 0;
  }

  /** setup token 文件路径：优先环境变量，其次安装目录下的 .setup-token */
  private tokenFilePath(): string {
    const configured = (this.configService.get<string>('SETUP_TOKEN_FILE') ?? '').trim();
    if (configured) return configured;
    return join(process.cwd(), '..', '.setup-token');
  }

  async getStatus(): Promise<SetupStatus> {
    const initialized = await this.isInitialized();
    const setupMode = this.isSetupMode();
    const tokenFile = this.tokenFilePath();
    return {
      initialized,
      setupMode,
      available: !initialized && setupMode && existsSync(tokenFile),
      siteTitle: '星云盘',
    };
  }

  /** 恒定时间比较，避免通过响应时间推断 token */
  private tokensMatch(provided: string, expected: string): boolean {
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }

  private readExpectedToken(input?: { setupTokenFile?: string }): string | null {
    const file = (input?.setupTokenFile ?? '').trim() || this.tokenFilePath();
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  }

  /** 校验 setup token；失败一律 403，不区分「文件不存在」与「token 错误」 */
  assertToken(provided: string, input?: { setupTokenFile?: string }): void {
    const expected = this.readExpectedToken(input);
    if (!expected) {
      throw new ForbiddenException('安装令牌不可用：请确认安装脚本已生成 .setup-token，或重新运行安装脚本');
    }
    if (!provided || !this.tokensMatch(provided, expected)) {
      throw new ForbiddenException('安装令牌不正确');
    }
  }

  /** Telegram 连通性自检：getMe + 可选 sendMessage，用于向导里的「发送测试消息」 */
  async testTelegram(botToken: string, chatId?: string): Promise<{ botUsername: string; messageSent: boolean }> {
    const base = (this.configService.get<string>('TELEGRAM_API_BASE') ?? '').trim() || 'https://api.telegram.org';
    if (!/^\d+:[\w-]+$/.test(botToken)) {
      throw new BadRequestException('Bot Token 格式应为 <bot_id>:<token>');
    }

    const call = async (method: string, payload: Record<string, unknown>) => {
      let response: Response;
      try {
        response = await fetch(`${base}/bot${botToken}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        // 网络不通 / 超时 / DNS 失败都归为「连不上」，给出可操作提示而不是 500
        throw new BadGatewayException(
          `无法连接 Telegram（${base}）：${(error as Error).message}。若服务器需要代理/自建 Bot API，请先在 .env 配置 TELEGRAM_API_BASE`,
        );
      }
      const body = await response.json().catch(() => ({ ok: false, description: '响应不是 JSON' })) as {
        ok?: boolean; description?: string; result?: { username?: string };
      };
      if (!body.ok) {
        throw new BadRequestException(`Telegram 返回失败：${body.description ?? response.status}`);
      }
      return body;
    };

    const me = await call('getMe', {});
    let messageSent = false;
    if (chatId && chatId.trim()) {
      await call('sendMessage', {
        chat_id: chatId.trim(),
        text: '星云盘安装自检：如果你看到这条消息，说明 Bot Token 与 Chat ID 配置正确。',
        disable_notification: true,
      });
      messageSent = true;
    }
    return { botUsername: me.result?.username ?? '', messageSent };
  }

  /** 原子写 .env：保留原有键，覆盖/追加本次向导的键；写完 chmod 600 */
  private writeEnv(envPath: string, updates: Record<string, string>): void {
    const preserved: string[] = [];
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const key = line.split('=')[0]?.trim() ?? '';
        if (key && Object.prototype.hasOwnProperty.call(updates, key)) continue;
        preserved.push(line);
      }
    }
    const merged = [
      ...preserved.filter((line) => line.trim().length > 0),
      ...Object.entries(updates).map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    ].join('\n');
    const tmp = `${envPath}.setup.${process.pid}`;
    writeFileSync(tmp, `${merged}\n`, { mode: 0o600 });
    renameSync(tmp, envPath);
  }

  /**
   * 完成向导：创建管理员 + 写 .env + 删除 setup token 文件。
   *
   * 顺序很重要：先建用户（事务内），成功后才改配置——这样即使写文件失败，
   * 也不会出现「配置改了但没有管理员」的半初始化状态。
   */
  async complete(input: CompleteSetupInput): Promise<{ restartRequired: boolean }> {
    if (await this.isInitialized()) {
      throw new ConflictException('系统已完成初始化，向导已关闭');
    }
    if (!this.isSetupMode()) {
      throw new ConflictException('当前不是向导模式（SETUP_MODE 未开启）');
    }
    this.assertToken(input.setupToken, { setupTokenFile: input.setupTokenFile });

    if (!/^\d+:[\w-]+$/.test(input.telegramBotToken)) {
      throw new BadRequestException('Bot Token 格式应为 <bot_id>:<token>');
    }
    if (!input.telegramChatId.trim()) {
      throw new BadRequestException('Telegram 存储 Chat ID 不能为空');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail)) {
      throw new BadRequestException('管理员邮箱格式不正确');
    }
    if (input.adminPassword.length < 8) {
      throw new BadRequestException('管理员密码至少 8 位');
    }
    if (!/^https?:\/\//.test(input.appUrl)) {
      throw new BadRequestException('站点 URL 需以 http:// 或 https:// 开头');
    }

    const passwordHash = await bcrypt.hash(input.adminPassword, 10);
    await this.userRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      if (await repo.count() > 0) {
        throw new ConflictException('系统已完成初始化，向导已关闭');
      }
      await repo.save(repo.create({
        email: input.adminEmail.trim().toLowerCase(),
        password: passwordHash,
        role: UserRole.SUPER_ADMIN,
        emailVerified: true,
        isBanned: false,
      }));
    });

    // SETUP_ENV_FILE 允许测试/集成环境指定目标文件，避免覆盖真实 .env
    const envPath = (this.configService.get<string>('SETUP_ENV_FILE') ?? '').trim()
      || join(process.cwd(), '.env');
    this.writeEnv(envPath, {
      APP_URL: input.appUrl,
      FRONTEND_URL: input.appUrl,
      CORS_ORIGINS: input.appUrl,
      SECURE_COOKIE: input.appUrl.startsWith('https://') ? 'true' : 'false',
      TELEGRAM_BOT_TOKEN: input.telegramBotToken,
      TELEGRAM_CHAT_ID: input.telegramChatId.trim(),
      // 关闭向导，并移除令牌引用：下次启动不会再进入 setup 模式
      SETUP_MODE: 'false',
      SITE_TITLE: input.siteTitle.trim() || '星云盘',
    });

    try {
      unlinkSync(this.tokenFilePath());
    } catch {
      this.logger.warn(`未能删除 setup token 文件：${this.tokenFilePath()}`);
    }

    this.logger.log('首次运行向导已完成：管理员已创建，配置已写入 .env');

    // 让进程退出，由 systemd 带着新配置重新拉起。
    // 注意：系统单元是 Restart=on-failure，退出码 0 不会触发重启，
    // 所以这里用 EX_TEMPFAIL(75) 表达「需要重启」，而不是改单元的重启策略
    //（Restart=always 会让其他正常退出场景也重启，副作用更大）。
    // 测试/CI 里用 SETUP_NO_EXIT=1 抑制，便于断言 .env 与数据库状态。
    if ((this.configService.get<string>('SETUP_NO_EXIT') ?? '0') !== '1') {
      setTimeout(() => process.exit(75), 500);
    }
    return { restartRequired: true };
  }

  /** 生成一次性 token（安装脚本使用；导出便于测试） */
  static generateToken(): string {
    return randomBytes(24).toString('hex');
  }
}
