import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 用户存储配额列（PostgreSQL）。
 *
 * 只新增可空列，属于 expand 式增量：旧代码（不读该列）可继续在新 schema 上运行。
 * 存量用户为 NULL，表示「继承全局默认 DEFAULT_USER_STORAGE_QUOTA_MB」，
 * 因此该迁移不需要回填，也不会改变任何既有用户的行为。
 *
 * 不做冗余用量计数列：用量由 QuotaService 对 files 表实时 SUM，
 * 避免多上传路径（同步/异步/分片/复制/覆盖）下的增减漂移。
 */
export class AddUserStorageQuota1804000000000 implements MigrationInterface {
  name = 'AddUserStorageQuota1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "storageQuotaBytes" bigint`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "storageQuotaBytes"`);
  }
}
