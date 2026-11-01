import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SetupService } from './setup.service';

/**
 * 向导服务的安全与状态机：
 * - token 必须校验（缺失文件、错误 token 都拒绝）；
 * - 只在未初始化时可用，完成后接口永久拒绝；
 * - 完成时：建管理员 → 写 .env（保留无关键、覆盖向导键、关闭 SETUP_MODE）→ 删 token 文件。
 */
describe('SetupService', () => {
  let dir: string;
  let envPath: string;
  let tokenPath: string;
  let users: Array<Record<string, unknown>>;
  let config: Record<string, string>;
  let service: SetupService;

  const userRepo = {
    count: jest.fn(async () => users.length),
    create: jest.fn((input: Record<string, unknown>) => input),
    save: jest.fn(async (input: Record<string, unknown>) => input),
    manager: {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
        const repo = {
          count: async () => users.length,
          create: (input: Record<string, unknown>) => input,
          save: async (input: Record<string, unknown>) => {
            users.push(input);
            return input;
          },
        };
        await cb({ getRepository: () => repo });
      }),
    },
  };

  beforeEach(() => {
    users = [];
    dir = mkdtempSync(join(tmpdir(), 'nebula-setup-'));
    envPath = join(dir, '.env');
    tokenPath = join(dir, '.setup-token');
    writeFileSync(tokenPath, 'token-abc-123\n', { mode: 0o600 });
    writeFileSync(envPath, 'DB_TYPE=sqlite\nEXISTING_KEY=keep-me\nTELEGRAM_BOT_TOKEN="old"\n', { mode: 0o600 });
    config = {
      SETUP_MODE: 'true',
      SETUP_TOKEN_FILE: tokenPath,
      SETUP_ENV_FILE: envPath,
      SETUP_NO_EXIT: '1',
    };
    const configService = { get: (key: string) => config[key] };
    service = new SetupService(userRepo as never, configService as never);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('未初始化 + 向导模式 + 令牌文件存在 → 向导可用', async () => {
    await expect(service.getStatus()).resolves.toMatchObject({
      initialized: false, setupMode: true, available: true,
    });
  });

  it('已有用户 → 向导不可用', async () => {
    users.push({ id: 'u1' });
    await expect(service.getStatus()).resolves.toMatchObject({ initialized: true, available: false });
  });

  it('令牌文件缺失 → 403（不区分“文件不存在”与“令牌错误”）', () => {
    expect(() => service.assertToken('anything', { setupTokenFile: join(dir, 'missing') }))
      .toThrow(ForbiddenException);
  });

  it('令牌错误 → 403', () => {
    expect(() => service.assertToken('wrong-token')).toThrow(ForbiddenException);
  });

  it('令牌正确 → 不抛错', () => {
    expect(() => service.assertToken('token-abc-123')).not.toThrow();
  });

  it('完成向导：创建超管 + 写 .env + 关闭 SETUP_MODE + 删除令牌文件', async () => {
    const result = await service.complete({
      setupToken: 'token-abc-123',
      siteTitle: '我的星云盘',
      appUrl: 'https://pan.example.com',
      telegramBotToken: '123456:abcdef',
      telegramChatId: '-1001234567890',
      adminEmail: 'Admin@Example.com',
      adminPassword: 'Sup3rSecret',
    });

    expect(result.restartRequired).toBe(true);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'admin@example.com', role: 'super_admin', emailVerified: true });

    const env = readFileSync(envPath, 'utf8');
    expect(env).toContain('SETUP_MODE="false"');
    expect(env).toContain('TELEGRAM_BOT_TOKEN="123456:abcdef"');
    expect(env).toContain('TELEGRAM_CHAT_ID="-1001234567890"');
    expect(env).toContain('APP_URL="https://pan.example.com"');
    expect(env).toContain('SECURE_COOKIE="true"');
    expect(env).toContain('SITE_TITLE="我的星云盘"');
    // 无关键必须保留（否则用户其他配置会被向导清空）
    expect(env).toContain('EXISTING_KEY=keep-me');
    expect(env).toContain('DB_TYPE=sqlite');
    // 旧的 Telegram token 被覆盖而不是重复出现
    expect(env.match(/TELEGRAM_BOT_TOKEN=/g)).toHaveLength(1);

    expect(existsSync(tokenPath)).toBe(false);
  });

  it('已初始化时完成向导 → 409', async () => {
    users.push({ id: 'u1' });
    await expect(service.complete({
      setupToken: 'token-abc-123',
      siteTitle: 'x',
      appUrl: 'http://localhost:3000',
      telegramBotToken: '123456:abcdef',
      telegramChatId: '-1',
      adminEmail: 'a@b.co',
      adminPassword: '12345678',
    })).rejects.toThrow(ConflictException);
  });

  it('参数不合法 → 400（在写库之前拦截）', async () => {
    await expect(service.complete({
      setupToken: 'token-abc-123',
      siteTitle: 'x',
      appUrl: 'ftp://nope',
      telegramBotToken: '123456:abcdef',
      telegramChatId: '-1',
      adminEmail: 'a@b.co',
      adminPassword: '12345678',
    })).rejects.toThrow(BadRequestException);
    expect(users).toHaveLength(0);
  });
});
