import { rm } from 'fs/promises';
import { join } from 'path';
import { DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn, Column } from 'typeorm';
import { VideoMetaService } from './video-meta.service';

/**
 * 用真实 SQLite 验证 VideoMetaService 的落库与打标逻辑。
 *
 * 为什么用最小实体而不是整个 App 的 DataSource：仓库的实体带 PostgreSQL 专属列类型
 * （如 `timestamp`），直接 synchronize 到 SQLite 会报 DataTypeNotSupported。
 * 这里只映射本次涉及的列，重点验证两件事：
 *   1) `file_tags` 插入用了方言安全的 QueryBuilder（历史上裸 SQL 的 `$1` 只在 PG 成立）；
 *   2) 重复分析幂等。
 */
@ Entity({ name: 'files' })
class TestFile {
  @PrimaryColumn() id!: string;
  @Column({ nullable: true }) mimeType!: string;
  @Column({ nullable: true }) uploaderId!: string;
  @Column({ type: 'simple-json', nullable: true }) videoMeta!: unknown;
}

@Entity({ name: 'tags' })
class TestTag {
  // 与真实 Tag 实体一致：uuid 主键由 TypeORM 生成（否则 save 缺 id 会失败）
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ default: '#0052d9' }) color!: string;
  @Column() userId!: string;
}

@Entity({ name: 'file_tags' })
class TestFileTag {
  @PrimaryColumn() fileId!: string;
  @PrimaryColumn() tagId!: string;
}

const DB_PATH = join(process.cwd(), 'tmp', `video-meta-${process.pid}-${Date.now()}.sqlite`);
const userId = '11111111-1111-4111-8111-111111111111';
const meta = {
  durationSeconds: 137, width: 1920, height: 1080, codec: 'H.264',
  hasAudio: true, bitrateKbps: 4820, frameRate: 29.97,
};
const config: Record<string, string> = { VIDEO_META_ENABLED: 'true' };

describe('VideoMetaService（真实 SQLite）', () => {
  let ds: DataSource;
  let service: VideoMetaService;

  const fileOf = (id: string, mimeType = 'video/mp4', originalName = 'a.mp4') =>
    ({ id, mimeType, uploaderId: userId, originalName } as never);

  beforeAll(async () => {
    ds = new DataSource({ type: 'sqlite', database: DB_PATH, entities: [TestFile, TestTag, TestFileTag], synchronize: true });
    await ds.initialize();
  }, 30_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    await rm(DB_PATH, { force: true });
  }, 30_000);

  beforeEach(async () => {
    await ds.query('DELETE FROM file_tags');
    await ds.query('DELETE FROM tags');
    await ds.query('DELETE FROM files');
    config.VIDEO_META_ENABLED = 'true';
    service = new VideoMetaService(
      ds.getRepository(TestFile) as never,
      ds.getRepository(TestTag) as never,
      { get: (key: string) => config[key] } as never,
    );
    // 桩掉 ffprobe（本机不一定装），只测落库与打标
    (service as unknown as { probe: () => Promise<unknown> }).probe = async () => meta;
  });

  it('写入元数据并创建带前缀的自动标签', async () => {
    await ds.getRepository(TestFile).save({ id: 'file-1', mimeType: 'video/mp4', uploaderId: userId });

    const result = await service.analyze(fileOf('file-1'), { sourcePath: '/tmp/x.mp4' });
    expect(result).toEqual(meta);

    const saved = await ds.getRepository(TestFile).findOne({ where: { id: 'file-1' } });
    expect(saved?.videoMeta).toMatchObject({ width: 1920, codec: 'H.264' });

    const tags = await ds.getRepository(TestTag).find();
    expect(tags.map((tag) => tag.name).sort()).toEqual(['自动·1080p', '自动·H.264', '自动·中等视频']);

    const links = await ds.query('SELECT "tagId" FROM file_tags WHERE "fileId" = ?', ['file-1']);
    expect(links).toHaveLength(3);
  });

  it('重复分析幂等：不重复建标签、不重复关联', async () => {
    await ds.getRepository(TestFile).save({ id: 'file-1', mimeType: 'video/mp4', uploaderId: userId });
    await service.analyze(fileOf('file-1'), { sourcePath: '/tmp/x.mp4' });
    await service.analyze(fileOf('file-1'), { sourcePath: '/tmp/x.mp4' });

    expect(await ds.getRepository(TestTag).count()).toBe(3);
    const links = await ds.query('SELECT "tagId" FROM file_tags WHERE "fileId" = ?', ['file-1']);
    expect(links).toHaveLength(3);
  });

  it('VIDEO_META_ENABLED=false 时完全不动作', async () => {
    config.VIDEO_META_ENABLED = 'false';
    await ds.getRepository(TestFile).save({ id: 'file-2', mimeType: 'video/mp4', uploaderId: userId });
    await expect(service.analyze(fileOf('file-2'))).resolves.toBeNull();
    expect(await ds.getRepository(TestTag).count()).toBe(0);
  });

  it('非视频文件直接跳过', async () => {
    await expect(service.analyze(fileOf('file-3', 'application/pdf'))).resolves.toBeNull();
    expect(await ds.getRepository(TestTag).count()).toBe(0);
  });

  it('ffprobe 解析失败时静默返回 null，不抛错', async () => {
    (service as unknown as { probe: () => Promise<unknown> }).probe = async () => null;
    await ds.getRepository(TestFile).save({ id: 'file-4', mimeType: 'video/mp4', uploaderId: userId });
    await expect(service.analyze(fileOf('file-4'), { sourcePath: '/tmp/y.mp4' })).resolves.toBeNull();
  });

  it('L2 归类：集数命名的视频额外得到「自动·剧集」标签', async () => {
    await ds.getRepository(TestFile).save({ id: 'file-5', mimeType: 'video/mp4', uploaderId: userId });
    await service.analyze(fileOf('file-5', 'video/mp4', 'Show.S01E02.1080p.mkv'), { sourcePath: '/tmp/z.mp4' });

    const tags = await ds.getRepository(TestTag).find();
    expect(tags.map((tag) => tag.name).sort()).toEqual([
      '自动·1080p', '自动·H.264', '自动·中等视频', '自动·剧集',
    ]);
  });

  it('L2 没有可靠线索时不加分类标签（避免误标）', async () => {
    await ds.getRepository(TestFile).save({ id: 'file-6', mimeType: 'video/mp4', uploaderId: userId });
    await service.analyze(fileOf('file-6', 'video/mp4', 'VID_20240101.mp4'), { sourcePath: '/tmp/w.mp4' });

    const tags = await ds.getRepository(TestTag).find();
    expect(tags.map((tag) => tag.name)).not.toContain('自动·剧集');
    expect(tags).toHaveLength(3);
  });
});
