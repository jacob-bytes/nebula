import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 上传内容去重：files.contentHash + (uploaderId, contentHash) 索引（PostgreSQL）。
 *
 * 只新增可空列与一个索引，属于 expand 式增量：存量行为 NULL（不参与去重），
 * 旧代码可在新 schema 上正常运行。
 */
export class AddFileContentHash1804200000000 implements MigrationInterface {
  name = 'AddFileContentHash1804200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "contentHash" varchar(64)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_files_uploader_hash" ON "files" ("uploaderId", "contentHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_files_uploader_hash"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN IF EXISTS "contentHash"`);
  }
}
