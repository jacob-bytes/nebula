import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';

/**
 * 升级路径回归：模拟「用户停在旧版本，装上新版本」时数据必须完好。
 *
 * 做法与真实升级一致：
 *   1. 建库并跑完整迁移链（= 当前版本）；
 *   2. 插入业务数据；
 *   3. `undoLastMigration()` 回退最后一版（= 旧 schema）；
 *   4. 再次 `runMigrations()`（= 用户升级到新版本时 entrypoint 做的事）；
 *   5. 断言：数据没丢、新结构已就位、迁移记录一致。
 *
 * 为什么值得单独测：迁移链里任何一步做了 `DROP TABLE` / 重建表而没搬数据，
 * 单元测试与类型检查都发现不了，只有真正跑一遍才知道。
 */
const DB_PATH = join(process.cwd(), 'tmp', `upgrade-migration-${process.pid}-${Date.now()}.sqlite`);

describe('升级路径：回退一版后重新迁移，数据不丢', () => {
  let dataSource: DataSource;
  const originalDbType = process.env.DB_TYPE;
  const originalDatabase = process.env.DB_DATABASE;
  let executedCount = 0;

  /** 已执行迁移数：以 migrations 表为准，避免依赖 DataSource 内部字段 */
  const appliedCount = async (): Promise<number> => {
    const rows = await dataSource.query('SELECT count(*) AS c FROM migrations') as Array<{ c: number | string }>;
    return Number(rows[0]!.c);
  };

  beforeAll(async () => {
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_DATABASE = DB_PATH;
    jest.resetModules();
    const { createDatabaseOptions } = require('./database.config') as typeof import('./database.config');
    dataSource = new DataSource(createDatabaseOptions({
      ...process.env,
      DB_TYPE: 'sqlite',
      DB_DATABASE: DB_PATH,
      DB_MIGRATIONS_RUN: 'false',
      DB_SQLITE_BUSY_TIMEOUT_MS: '10',
    }));
    await dataSource.initialize();
    await dataSource.runMigrations();
    executedCount = await (async () => {
      const rows = await dataSource.query('SELECT count(*) AS c FROM migrations') as Array<{ c: number | string }>;
      return Number(rows[0]!.c);
    })();
    await dataSource.query('PRAGMA foreign_keys = ON');
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await rm(DB_PATH, { force: true });
    if (originalDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = originalDbType;
    if (originalDatabase === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = originalDatabase;
  }, 60_000);

  it('迁移链非空，保证本用例测的是真实结构', () => {
    // SQLite 走独立的 *-Sqlite* 迁移链（不含 PostgreSQL 专有迁移），当前约 25 条
    expect(executedCount).toBeGreaterThan(20);
  });

  it('回退最后一版 → 重新迁移：用户与文件数据完好', async () => {
    const userId = randomUUID();
    const fileId = randomUUID();
    const email = `upgrade-${userId.slice(0, 8)}@example.com`;

    await dataSource.query(
      `INSERT INTO users (id, email, password, role, "isBanned", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, email, 'hashed', 'user'],
    );
    await dataSource.query(
      `INSERT INTO files (
         id, filename, "originalName", "mimeType", size, "telegramFileId", "telegramFilePath",
         "uploaderId", "accessType", "maxAccessCount", "currentAccessCount", "isDeleted",
         status, "uploadVersion", "uploadStage", "createdAt", "updatedAt"
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [fileId, 'tg-upgrade', '升级验证.pdf', 'application/pdf', 1024, 'tg-upgrade', '', userId,
        'private', -1, 'ready', 'committed'],
    );

    // 1) 回退最后一版：得到「旧版本 schema」
    await dataSource.undoLastMigration();
    expect(await appliedCount()).toBe(executedCount - 1);

    // 2) 重新迁移：模拟新版本启动时 entrypoint 执行的 migration:run
    await dataSource.runMigrations();
    expect(await appliedCount()).toBe(executedCount);

    // 3) 数据仍在
    const users = await dataSource.query('SELECT email FROM users WHERE id = ?', [userId]) as Array<{ email: string }>;
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe(email);

    const files = await dataSource.query('SELECT "originalName", size FROM files WHERE id = ?', [fileId]) as Array<{ originalName: string; size: number }>;
    expect(files).toHaveLength(1);
    expect(files[0]!.originalName).toBe('升级验证.pdf');

    // 4) 迁移记录回到完整状态，且没有重复执行
    expect(await appliedCount()).toBe(executedCount);
  }, 60_000);

  it('迁移后再执行一次是空操作（幂等，重复启动安全）', async () => {
    const before = await appliedCount();
    await dataSource.runMigrations();
    expect(await appliedCount()).toBe(before);
  }, 30_000);
});
