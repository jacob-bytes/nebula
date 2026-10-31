import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

/**
 * 补齐 SQLite 缺失的 `file_tags` 关联表。
 *
 * 背景：`file_tags` 只在 PostgreSQL 迁移 `AddTagsAndFileTags1790000000000` 中创建，
 * 而 SQLite 只加载以 `Sqlite` 命名的迁移子集，因此 SQLite 部署**从来没有**这张表。
 * SQLite 基线迁移 `SqliteEntitySchema` 只按实体建表，不会创建 `@ManyToMany` 的
 * 连接表（`tags` 是实体所以存在，`file_tags` 是连接表所以缺失）。
 *
 * 影响：只要有文件记录，`GET /api/files` 在加载标签关联时就会
 * `SQLITE_ERROR: no such table: file_tags` 并返回 500；空库时因为不触发关联查询
 * 所以看起来正常，这也是它一直没被发现的原因。
 *
 * 本迁移按 PG 版本等价补齐：两列复合主键 + 指向 files/tags 的级联外键，
 * 并保持幂等（表已存在则直接返回）。
 */
export class SqliteAddFileTags1804300000000 implements MigrationInterface {
  name = 'SqliteAddFileTags1804300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    if (await queryRunner.hasTable('file_tags')) return;

    await queryRunner.createTable(
      new Table({
        name: 'file_tags',
        // 复合主键用列级 isPrimary 表达：SQLite 的 ALTER TABLE 不能事后加主键，
        // 必须在 CREATE TABLE 时一次性定义。
        columns: [
          { name: 'fileId', type: 'varchar', isPrimary: true, isNullable: false },
          { name: 'tagId', type: 'varchar', isPrimary: true, isNullable: false },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['fileId'],
            referencedColumnNames: ['id'],
            referencedTableName: 'files',
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            columnNames: ['tagId'],
            referencedColumnNames: ['id'],
            referencedTableName: 'tags',
            onDelete: 'CASCADE',
          }),
        ],
      }),
      true,
    );

    // 按 tagId 的反查索引：标签筛选（多标签 AND）会从标签侧驱动查询
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_file_tags_tag" ON "file_tags" ("tagId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'sqlite') return;
    if (!(await queryRunner.hasTable('file_tags'))) return;
    await queryRunner.dropTable('file_tags');
  }
}
