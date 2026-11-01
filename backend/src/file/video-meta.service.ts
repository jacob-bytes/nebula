import { spawn } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File } from '../common/entities/file.entity';
import { Tag } from '../common/entities/tag.entity';
import {
  AUTO_TAG_PREFIX,
  autoTagColor,
  deriveVideoTags,
  parseFfprobeOutput,
  type VideoMetadata,
} from './video-meta';

/** ffprobe 超时：只读容器头，正常在毫秒级；给 15s 兜住网络盘/异常文件 */
const FFPROBE_TIMEOUT_MS = 15_000;
/** 单个文件最多打几个自动标签（画质/编码/时长 = 3，留余量） */
const MAX_AUTO_TAGS = 4;

export interface VideoAnalyzeOptions {
  /** 已在本地的视频文件路径（上传临时文件或缓存文件） */
  sourcePath?: string;
  /** 内存中的视频字节（小文件）；与 sourcePath 二选一 */
  sourceBuffer?: Buffer;
}

/**
 * 视频元数据分析（L1）→ 自动标签。
 *
 * 定位：**增值功能**，任何失败都只记录日志，绝不影响上传结果。
 * 只使用客观字段（时长/分辨率/编码/音轨），因此标签不会误判；
 * 内容级识别（电影/剧集）留给 L2 规则层，语义识别留给 L3 模型层。
 *
 * 幂等：同一文件重复分析不会产生重复标签（按 name 复用已有 tag，已有关联跳过）。
 */
@Injectable()
export class VideoMetaService {
  private readonly logger = new Logger(VideoMetaService.name);
  private ffprobeMissingLogged = false;

  constructor(
    @InjectRepository(File) private readonly fileRepo: Repository<File>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    private readonly configService: ConfigService,
  ) {}

  private isEnabled(): boolean {
    return (this.configService.get<string>('VIDEO_META_ENABLED') ?? 'true').trim().toLowerCase() !== 'false';
  }

  private ffprobePath(): string {
    return (this.configService.get<string>('FFPROBE_PATH') ?? '').trim() || 'ffprobe';
  }

  /** 解析视频源文件；不存在/不是视频/解析失败都返回 null */
  private async probe(source: string): Promise<VideoMetadata | null> {
    const raw = await new Promise<string | null>((resolve) => {
      let stdout = '';
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const child = spawn(this.ffprobePath(), [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        source,
      ]);

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* 进程可能已退出 */ }
        this.logger.warn(`ffprobe 超时，跳过元数据分析：${source}`);
        finish(null);
      }, FFPROBE_TIMEOUT_MS);
      timer.unref?.();

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' && !this.ffprobeMissingLogged) {
          this.ffprobeMissingLogged = true;
          this.logger.warn('未找到 ffprobe（随 ffmpeg 安装）；视频自动标签将不可用。可设置 FFPROBE_PATH 指定路径。');
        }
        finish(null);
      });
      child.once('close', (code) => finish(code === 0 ? stdout : null));
    });

    if (!raw) return null;
    return parseFfprobeOutput(raw);
  }

  /** 按名称复用或创建用户的标签，返回 tagId 列表 */
  private async ensureTags(userId: string, names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const existing = await this.tagRepo.find({ where: names.map((name) => ({ userId, name })) });
    const byName = new Map(existing.map((tag) => [tag.name, tag.id]));
    const missing = names.filter((name) => !byName.has(name));

    for (const name of missing) {
      // 并发上传同一视频时可能撞唯一索引（userId+name）：冲突后回查即可
      try {
        const created = await this.tagRepo.save(this.tagRepo.create({
          userId,
          name: name.slice(0, 50),
          color: autoTagColor(name),
        }));
        byName.set(name, created.id);
      } catch {
        const found = await this.tagRepo.findOne({ where: { userId, name } });
        if (found) byName.set(name, found.id);
      }
    }

    return names.map((name) => byName.get(name)).filter((id): id is string => Boolean(id));
  }

  /** 已关联的标签，避免重复插入 */
  private async attachedTagIds(fileId: string): Promise<Set<string>> {
    // 用 QueryBuilder 而不是裸 SQL：$1 占位符只在 PostgreSQL 成立，SQLite 会直接报错
    const rows = await this.fileRepo.manager
      .createQueryBuilder()
      .select('ft.tagId', 'tagId')
      .from('file_tags', 'ft')
      .where('ft.fileId = :fileId', { fileId })
      .getRawMany<{ tagId: string }>();
    return new Set(rows.map((row) => row.tagId));
  }

  /**
   * 分析并打标。返回元数据（供调用方记录/展示），失败一律返回 null。
   *
   * 调用点是上传完成后的封面生成流程，因此**不额外下载**：优先用调用方给的
   * 临时文件/缓存文件；都没有就跳过（不为了打标签去回源整个视频）。
   */
  async analyze(file: File, options: VideoAnalyzeOptions = {}): Promise<VideoMetadata | null> {
    if (!this.isEnabled()) return null;
    if (!file.mimeType?.startsWith('video/')) return null;

    try {
      const meta = await this.probeFrom(options);
      if (!meta) return null;

      // 1) 落库：便于「重新扫描」判断与后续在列表里展示时长/分辨率
      await this.fileRepo.update({ id: file.id }, { videoMeta: meta });

      // 2) 打自动标签（幂等）
      const names = deriveVideoTags(meta).slice(0, MAX_AUTO_TAGS);
      const tagIds = await this.ensureTags(file.uploaderId, names);
      if (tagIds.length === 0) return meta;

      const attached = await this.attachedTagIds(file.id);
      const toAttach = tagIds.filter((id) => !attached.has(id));
      if (toAttach.length > 0) {
        // 用 QueryBuilder 生成方言占位符：raw INSERT 里的 $1/$2 只在 PostgreSQL 成立
        await this.fileRepo.manager
          .createQueryBuilder()
          .insert()
          .into('file_tags')
          .values(toAttach.map((tagId) => ({ fileId: file.id, tagId })))
          .execute();
      }

      this.logger.log(
        `视频元数据已写入 id=${file.id} ${meta.width}x${meta.height} ${meta.codec} `
        + `${meta.durationSeconds}s；新增自动标签 ${toAttach.length} 个`,
      );
      return meta;
    } catch (error) {
      // 增值功能：任何异常都不能冒泡到上传流程
      this.logger.warn(`视频元数据分析失败 id=${file.id}：${(error as Error).message}`);
      return null;
    }
  }

  private async probeFrom(options: VideoAnalyzeOptions): Promise<VideoMetadata | null> {
    if (options.sourcePath) return this.probe(options.sourcePath);
    if (options.sourceBuffer?.length) {
      const tmp = `${process.env.TMPDIR ?? '/tmp'}/nebula-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { promises: fs } = await import('fs');
      await fs.writeFile(tmp, options.sourceBuffer);
      try {
        return await this.probe(tmp);
      } finally {
        await fs.unlink(tmp).catch(() => {});
      }
    }
    return null;
  }
}

/** 自动标签前缀对外导出，便于前端/测试识别系统标签 */
export { AUTO_TAG_PREFIX };
