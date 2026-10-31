import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 用户存储配额列（SQLite）。
 *
 * SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，因此先读 table_info
 * 判断列是否已存在，保证重复执行幂等（与仓库其他 SQLite 增量迁移一致）。
 * 类型用 integer（SQLite 动态类型），语义与 PostgreSQL 的 bigint 对应。
 */
export class SqliteAddUserStorageQuota1804000000000 implements MigrationInterface {
  name = 'SqliteAddUserStorageQuota1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    const columns: Array<{ name: string }> = await queryRunner.query('PRAGMA table_info("users")');
    if (columns.some((column) => column.name === 'storageQuotaBytes')) return;
    await queryRunner.query('ALTER TABLE "users" ADD COLUMN "storageQuotaBytes" integer');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    // SQLite 3.35+ 支持 DROP COLUMN；旧版本会报错，届时保持列为空即可（不影响业务）。
    try {
      await queryRunner.query('ALTER TABLE "users" DROP COLUMN "storageQuotaBytes"');
    } catch {
      // 降级路径：列残留但无代码读取，属于可接受状态
    }
  }
}
