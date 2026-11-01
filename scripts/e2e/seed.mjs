#!/usr/bin/env node
/**
 * E2E 固定数据：一个管理员 + 一个带配额的普通用户 + 一个文件 + 一条公开分享。
 *
 * 用后端自带的 sqlite3 驱动写入，避免额外依赖；密码用 bcryptjs（与后端同版本）。
 * 数据是确定性的（固定 id / 固定 token），断言可以直接写死。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite3 = require('../../backend/node_modules/sqlite3');
const bcrypt = require('../../backend/node_modules/bcryptjs');

const DB_FILE = process.env.DB_FILE;
if (!DB_FILE) {
  console.error('缺少 DB_FILE 环境变量');
  process.exit(1);
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';
const SHARE_TOKEN = 'e2eshare01';
const PASSWORD = 'E2ePassw0rd!';
const GB = 1024 * 1024 * 1024;

const db = new sqlite3.Database(DB_FILE);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (err) => (err ? reject(err) : resolve()));
});

try {
  const adminHash = bcrypt.hashSync(PASSWORD, 10);
  const userHash = bcrypt.hashSync(PASSWORD, 10);

  await run(
    `INSERT INTO users (id, email, password, role, "isBanned", "emailVerified", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'super_admin', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [ADMIN_ID, 'e2e-admin@example.com', adminHash],
  );

  await run(
    `INSERT INTO users (id, email, password, role, "isBanned", "emailVerified", "storageQuotaBytes", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'user', 0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [USER_ID, 'e2e-user@example.com', userHash, 5 * GB],
  );

  await run(
    `INSERT INTO files (
       id, filename, "originalName", "mimeType", size, "telegramFileId", "telegramFilePath",
       "uploaderId", "accessType", "maxAccessCount", "currentAccessCount", "isDeleted",
       status, "uploadVersion", "uploadStage", "createdAt", "updatedAt"
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', -1, 0, 0, 'ready', 1, 'committed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    // 归属管理员：/files 只列当前用户自己的文件，测试用管理员登录就必须是他名下
    [FILE_ID, 'tg-e2e', 'E2E 验证文件.pdf', 'application/pdf', 4_800_000, 'tg-e2e', '', ADMIN_ID],
  );

  await run(
    `INSERT INTO share_links (id, token, "targetType", "targetId", "creatorId", password,
       "maxAccessCount", "currentAccessCount", "createdAt", "updatedAt")
     VALUES (?, ?, 'file', ?, ?, NULL, -1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [SHARE_ID, SHARE_TOKEN, FILE_ID, ADMIN_ID],
  );

  console.log('[e2e] 测试数据写入完成');
} catch (error) {
  console.error('[e2e] 写入失败：', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}

export {};
