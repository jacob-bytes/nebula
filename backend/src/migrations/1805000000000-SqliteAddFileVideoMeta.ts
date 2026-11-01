import { MigrationInterface, QueryRunner } from 'typeorm';

/** 视频元数据（L1）：files.videoMeta（SQLite）。与 PostgreSQL 版等价，幂等。 */
export class SqliteAddFileVideoMeta1805000000000 implements MigrationInterface {
  name = 'SqliteAddFileVideoMeta1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    const columns: Array<{ name: string }> = await queryRunner.query('PRAGMA table_info("files")');
    if (!columns.some((column) => column.name === 'videoMeta')) {
      await queryRunner.query('ALTER TABLE "files" ADD COLUMN "videoMeta" text');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    try {
      await queryRunner.query('ALTER TABLE "files" DROP COLUMN "videoMeta"');
    } catch {
      // 旧版 SQLite 不支持 DROP COLUMN：列残留但无代码读取
    }
  }
}
