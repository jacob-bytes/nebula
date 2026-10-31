import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 文件存储定位字段（PostgreSQL）。
 *
 * 只新增可空列，属于 expand 式增量：
 * - `storageProvider` 为空 = 存量文件仍走 Telegram（与改造前逐字节一致）；
 * - `storageKey` 为对象存储内的 key，仅 `storageProvider='s3'` 时使用。
 *
 * 失败回滚只删列，不动任何既有列，因此旧代码可在新 schema 上继续运行。
 */
export class AddFileStorageLocator1804100000000 implements MigrationInterface {
  name = 'AddFileStorageLocator1804100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "storageProvider" varchar(32)`);
    await queryRunner.query(`ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "storageKey" varchar(1024)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN IF EXISTS "storageKey"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN IF EXISTS "storageProvider"`);
  }
}
