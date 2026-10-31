import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 上传内容去重：files.contentHash + (uploaderId, contentHash) 索引（SQLite）。
 *
 * 与 PostgreSQL 版等价：先读 table_info/index_list 判断存在性，保证重复执行幂等。
 */
export class SqliteAddFileContentHash1804200000000 implements MigrationInterface {
  name = 'SqliteAddFileContentHash1804200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;

    const columns: Array<{ name: string }> = await queryRunner.query('PRAGMA table_info("files")');
    if (!columns.some((column) => column.name === 'contentHash')) {
      await queryRunner.query('ALTER TABLE "files" ADD COLUMN "contentHash" varchar(64)');
    }

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_files_uploader_hash" ON "files" ("uploaderId", "contentHash")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    await queryRunner.query('DROP INDEX IF EXISTS "idx_files_uploader_hash"');
    try {
      await queryRunner.query('ALTER TABLE "files" DROP COLUMN "contentHash"');
    } catch {
      // SQLite 旧版本不支持 DROP COLUMN：列残留但无代码读取
    }
  }
}
