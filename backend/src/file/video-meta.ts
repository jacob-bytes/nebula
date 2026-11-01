/**
 * 视频元数据解析与「技术标签」推导（L1）。
 *
 * 设计取向：
 * - **纯函数**：输入 ffprobe 的 JSON 输出，输出结构化元数据与标签名，便于单测覆盖；
 * - **确定性**：只用容器/流的客观字段，不做猜谜式的内容识别，因此不会误判；
 * - **自动标签带前缀**：`自动·` 前缀让它们与用户手写标签在视觉与语义上分开，
 *   用户看到就知道「这是系统打的，可以删」。
 */

/** 自动标签统一前缀：用户手动标签不会以此开头（创建时会校验） */
export const AUTO_TAG_PREFIX = '自动·';

export interface VideoMetadata {
  /** 时长（秒，四舍五入到整数） */
  durationSeconds: number;
  /** 画面宽高（像素） */
  width: number;
  height: number;
  /** 视频编码的规范化名称：H.264 / H.265 / AV1 / VP9 / … */
  codec: string;
  /** 是否含音轨 */
  hasAudio: boolean;
  /** 总码率（kbps），拿不到时为 null */
  bitrateKbps: number | null;
  /** 帧率，拿不到时为 null */
  frameRate: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** 编码名归一化：ffprobe 给的是小写标识（h264/hevc/av1/vp9…） */
function normalizeCodec(raw: string | undefined): string {
  const codec = (raw ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    h264: 'H.264',
    hevc: 'H.265',
    h265: 'H.265',
    av1: 'AV1',
    vp9: 'VP9',
    vp8: 'VP8',
    mpeg4: 'MPEG-4',
    prores: 'ProRes',
  };
  if (map[codec]) return map[codec];
  if (!codec) return '未知编码';
  // 未收录的编码保留原始标识并大写，避免误标
  return codec.toUpperCase();
}

/** 解析 `avg_frame_rate`（形如 `30000/1001`） */
function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const [num, den] = raw.split('/').map((item) => Number.parseFloat(item));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) return null;
  return Math.round(fps * 100) / 100;
}

/**
 * 解析 ffprobe 输出。
 *
 * 返回 null 表示「这不是一个能识别的视频」（无视频流 / JSON 坏掉 / 关键字段缺失），
 * 调用方应静默跳过——分析是增值功能，不能影响上传。
 */
export function parseFfprobeOutput(raw: string): VideoMetadata | null {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(raw) as FfprobeOutput;
  } catch {
    return null;
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) return null;

  const width = Number(video.width ?? 0);
  const height = Number(video.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const durationRaw = Number.parseFloat(parsed.format?.duration ?? '');
  const durationSeconds = Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.round(durationRaw) : 0;

  const bitrateRaw = Number.parseFloat(parsed.format?.bit_rate ?? '');
  const bitrateKbps = Number.isFinite(bitrateRaw) && bitrateRaw > 0 ? Math.round(bitrateRaw / 1000) : null;

  return {
    durationSeconds,
    width,
    height,
    codec: normalizeCodec(video.codec_name),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    bitrateKbps,
    frameRate: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate),
  };
}

/** 画质档位：按短边判定（竖屏视频也能正确归到 1080p） */
export function qualityLabel(meta: Pick<VideoMetadata, 'width' | 'height'>): string {
  const shortSide = Math.min(meta.width, meta.height);
  if (shortSide >= 2160) return '4K';
  if (shortSide >= 1080) return '1080p';
  if (shortSide >= 720) return '720p';
  if (shortSide >= 480) return '480p';
  return 'SD';
}

/** 时长档位：短视频 / 中等 / 长视频 */
export function durationLabel(seconds: number): string {
  if (seconds > 0 && seconds < 60) return '短视频';
  if (seconds < 20 * 60) return '中等视频';
  return '长视频';
}

/**
 * 从元数据推导自动标签。
 *
 * 只输出三个维度（画质 / 编码 / 时长），刻意不做「电影/剧集」这类内容判断——
 * 那属于 L2 规则识别，依赖文件名，命名不规范时会误判。
 */
export function deriveVideoTags(meta: VideoMetadata): string[] {
  return [
    `${AUTO_TAG_PREFIX}${qualityLabel(meta)}`,
    `${AUTO_TAG_PREFIX}${meta.codec}`,
    `${AUTO_TAG_PREFIX}${durationLabel(meta.durationSeconds)}`,
  ];
}

/** 自动标签配色：同一维度用固定色，列表里更易扫读 */
export function autoTagColor(name: string): string {
  if (name.includes('4K') || name.includes('1080p')) return '#1E40AF';
  if (name.includes('720p') || name.includes('480p') || name.includes('SD')) return '#475569';
  if (['H.264', 'H.265', 'AV1', 'VP9'].some((codec) => name.includes(codec))) return '#0F766E';
  if (name.includes('短视频')) return '#7C3AED';
  if (name.includes('中等视频')) return '#B45309';
  if (name.includes('长视频')) return '#0E7490';
  return '#64748B';
}
