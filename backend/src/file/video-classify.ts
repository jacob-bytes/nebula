/**
 * 视频内容归类（L2）：用**文件名 + L1 元数据**做规则判定。
 *
 * 与 L3（内容识别）的边界：这里不"看画面"，只根据命名与容器特征推断，
 * 因此：
 * - 命名规范时准确率很高（`S01E02`、`第3集`、`MV`、`Screen Recording`）；
 * - 命名混乱时宁可不分类（返回 null），也不猜——错误的标签比没有标签更糟。
 *
 * 判定优先级（自上而下，先命中先返回）：
 *   剧集 > 录屏 > 音乐视频 > 电影 > 短视频 > 未分类
 */

export type VideoCategory = '剧集' | '电影' | '音乐视频' | '录屏' | '短视频';

export interface ClassifyInput {
  /** 原始文件名（含扩展名） */
  filename: string;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  bitrateKbps: number | null;
}

export interface ClassifyResult {
  category: VideoCategory;
  /** 命中原因，便于日志与排查（不进标签） */
  reason: string;
}

/** 集数标记：S01E02 / EP04 / 第3集 / 1x02 —— 常见于剧集命名 */
const EPISODE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:^|[^a-z0-9])s\d{1,2}\s*[-_. ]?e\d{1,4}(?:[^a-z0-9]|$)/i, reason: '文件名含 SxxExx' },
  { pattern: /(?:^|[^a-z])(?:e|ep|episode)\s*[-_.]?\d{1,4}(?:[^0-9]|$)/i, reason: '文件名含 EPxx' },
  { pattern: /第\s*\d{1,4}\s*[集话話期]/, reason: '文件名含「第 N 集」' },
  { pattern: /(?:^|[^0-9])\d{1,2}\s*x\s*\d{2,3}(?:[^0-9]|$)/i, reason: '文件名含 1x02 形式集号' },
  { pattern: /(?:season|季)\s*\d{1,2}/i, reason: '文件名含季标记' },
];

/** 录屏线索：软件名或明确的录屏字样 */
const SCREEN_RECORDING_HINTS: RegExp[] = [
  /screen[\s_-]?record/i,
  /screenflow|bandicam|camtasia|obs[\s_-]?studio/i,
  /录屏|屏幕录制|屏幕录像|桌面录制/,
];

/** 音乐视频线索 */
const MUSIC_VIDEO_HINTS: RegExp[] = [
  /(?:^|[^a-z])mv(?:[^a-z]|$)/i,
  /official\s*(?:music\s*)?video/i,
  /\blyric(?:s)?\b/i,
  /音乐视频|官方\s*mv|歌词版/,
];

const YEAR_PATTERN = /(?:19|20)\d{2}/;

/** 常见屏幕分辨率：命中说明画面尺寸与显示器一致（录屏的强特征之一） */
const SCREEN_RESOLUTIONS = new Set([
  '1920x1080', '2560x1440', '3840x2160', '1366x768',
  '1440x900', '1680x1050', '2880x1800', '1600x900',
  '1280x720', '2560x1600', '3440x1440', '1920x1200',
]);

/** 电影时长下限：低于此不考虑判为电影（避免把长 vlog 当电影） */
const MOVIE_MIN_SECONDS = 75 * 60;
/** 音乐视频时长窗口（秒） */
const MUSIC_MIN_SECONDS = 45;
const MUSIC_MAX_SECONDS = 15 * 60;
/** 短视频时长上限（秒） */
const SHORT_MAX_SECONDS = 60;
/** 录屏的码率上限（kbps）：屏幕内容压缩率高，通常远低于同分辨率实拍 */
const SCREEN_RECORDING_MAX_KBPS = 1200;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * 归类。返回 null 表示「无法可靠判断」，调用方不应据此打标签。
 *
 * 说明：剧集优先于电影——一集 80 分钟的剧集文件名里有 `S01E01` 时，
 * 应该归到剧集而不是电影。
 */
export function classifyVideo(input: ClassifyInput): ClassifyResult | null {
  const name = input.filename ?? '';
  const { durationSeconds, width, height, bitrateKbps } = input;

  // 1) 剧集：命名里有明确集数
  for (const { pattern, reason } of EPISODE_PATTERNS) {
    if (pattern.test(name)) return { category: '剧集', reason };
  }

  // 2) 录屏：软件/字样线索，或「屏幕分辨率 + 低码率」（同为 1080p，录屏码率通常 < 1.2Mbps）
  for (const pattern of SCREEN_RECORDING_HINTS) {
    if (pattern.test(name)) return { category: '录屏', reason: `文件名含 ${pattern.source}` };
  }
  const resolution = `${width}x${height}`;
  if (
    SCREEN_RESOLUTIONS.has(resolution)
    && bitrateKbps !== null
    && bitrateKbps > 0
    && bitrateKbps < SCREEN_RECORDING_MAX_KBPS
    && durationSeconds >= SHORT_MAX_SECONDS
  ) {
    return { category: '录屏', reason: `屏幕分辨率 ${resolution} 且码率 ${bitrateKbps}kbps 偏低` };
  }

  // 3) 音乐视频：需要明确线索 + 合理时长（避免把整场演唱会当 MV）
  if (
    matchesAny(name, MUSIC_VIDEO_HINTS)
    && durationSeconds >= MUSIC_MIN_SECONDS
    && durationSeconds <= MUSIC_MAX_SECONDS
  ) {
    return { category: '音乐视频', reason: '文件名含 MV/官方视频线索且时长在合理区间' };
  }

  // 4) 电影：长片 +（命名含年份 或 没有任何集数标记）
  if (durationSeconds >= MOVIE_MIN_SECONDS) {
    const reason = YEAR_PATTERN.test(name) ? '时长 ≥75 分钟且文件名含年份' : '时长 ≥75 分钟';
    return { category: '电影', reason };
  }

  // 5) 短视频：竖屏 + 60 秒内
  if (durationSeconds > 0 && durationSeconds <= SHORT_MAX_SECONDS && height > width) {
    return { category: '短视频', reason: '竖屏且 ≤60 秒' };
  }

  return null;
}
