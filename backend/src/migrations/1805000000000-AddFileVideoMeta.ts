import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 视频元数据（L1）：files.videoMeta（PostgreSQL）。
 *
 * 存 ffprobe 解析结果（时长/宽高/编码/音轨/码率/帧率），用途：
 * 1) 幂等判断——已分析过的文件可跳过/重扫；
 * 2) 后续在列表里展示时长、按分辨率筛选。
 *
 * 只新增可空列：存量行为 NULL，旧代码可在新 schema 上运行。
 */
export class AddFileVideoMeta1805000000000 implements MigrationInterface {
  name = 'AddFileVideoMeta1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "videoMeta" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN IF EXISTS "videoMeta"`);
  }
}
