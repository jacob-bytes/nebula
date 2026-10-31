import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 文件存储定位字段（SQLite）。
 *
 * 与 PostgreSQL 版等价：两个可空列，逐列检查后再添加以保持幂等
 * （SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS）。
 */
export class SqliteAddFileStorageLocator1804100000000 implements MigrationInterface {
  name = 'SqliteAddFileStorageLocator1804100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    const columns: Array<{ name: string }> = await queryRunner.query('PRAGMA table_info("files")');
    const existing = new Set(columns.map((column) => column.name));
    if (!existing.has('storageProvider')) {
      await queryRunner.query('ALTER TABLE "files" ADD COLUMN "storageProvider" varchar(32)');
    }
    if (!existing.has('storageKey')) {
      await queryRunner.query('ALTER TABLE "files" ADD COLUMN "storageKey" varchar(1024)');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    // SQLite 3.35+ 才支持 DROP COLUMN；旧版本保留列即可（无代码读取）
    for (const column of ['storageKey', 'storageProvider']) {
      try {
        await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "${column}"`);
      } catch {
        // 降级路径：列残留但不影响业务
      }
    }
  }
}
