import { classifyVideo, type ClassifyInput } from './video-classify';

const base: ClassifyInput = {
  filename: 'a.mp4',
  durationSeconds: 137,
  width: 1920,
  height: 1080,
  hasAudio: true,
  bitrateKbps: 4820,
};

const classify = (patch: Partial<ClassifyInput>) => classifyVideo({ ...base, ...patch });

describe('视频归类（L2 规则）', () => {
  describe('剧集', () => {
    it.each([
      ['Show.S01E02.1080p.mkv', 'SxxExx'],
      ['某剧 第3集.mp4', '第 N 集'],
      ['Anime EP04.mp4', 'EPxx'],
      ['Series 1x02.mp4', '1x02'],
      ['Friends Season 2 Ep5.mp4', '季标记'],
    ])('%s → 剧集', (filename) => {
      expect(classify({ filename })?.category).toBe('剧集');
    });

    it('剧集优先于电影：80 分钟的剧集仍归剧集', () => {
      expect(classify({ filename: 'Show.S01E01.mkv', durationSeconds: 80 * 60 })?.category).toBe('剧集');
    });
  });

  describe('录屏', () => {
    it('软件名线索命中', () => {
      expect(classify({ filename: 'obs studio 2024-01-01.mp4' })?.category).toBe('录屏');
    });

    it('中文录屏字样命中', () => {
      expect(classify({ filename: '屏幕录制 2024.mp4' })?.category).toBe('录屏');
    });

    it('屏幕分辨率 + 低码率命中（同 1080p，录屏压缩率高）', () => {
      expect(classify({ filename: 'demo.mp4', bitrateKbps: 800, durationSeconds: 300 })?.category).toBe('录屏');
    });

    it('同分辨率但码率正常 → 不判录屏', () => {
      expect(classify({ filename: 'demo.mp4', bitrateKbps: 6000, durationSeconds: 300 })).toBeNull();
    });

    it('码率未知时不做录屏推断', () => {
      expect(classify({ filename: 'demo.mp4', bitrateKbps: null, durationSeconds: 300 })).toBeNull();
    });
  });

  describe('音乐视频', () => {
    it.each(['Song Official Video.mp4', 'Artist - Title (Lyric Video).mp4', '某歌手 - 歌名 MV.mp4'])('%s → 音乐视频', (filename) => {
      expect(classify({ filename, durationSeconds: 240 })?.category).toBe('音乐视频');
    });

    it('时长超出窗口（整场演唱会）不判音乐视频', () => {
      expect(classify({ filename: 'Official Video Live Concert.mp4', durationSeconds: 90 * 60 })?.category).toBe('电影');
    });

    it('只有 MV 字样但时长过短（预告）不判音乐视频', () => {
      expect(classify({ filename: 'MV teaser.mp4', durationSeconds: 20 })).toBeNull();
    });
  });

  describe('电影', () => {
    it('≥75 分钟且含年份', () => {
      const result = classify({ filename: 'Inception (2010).mkv', durationSeconds: 148 * 60 });
      expect(result?.category).toBe('电影');
      expect(result?.reason).toContain('年份');
    });

    it('≥75 分钟无年份也算电影', () => {
      expect(classify({ filename: 'movie.mkv', durationSeconds: 100 * 60 })?.category).toBe('电影');
    });

    it('74 分钟不判电影', () => {
      expect(classify({ filename: 'movie.mkv', durationSeconds: 74 * 60 })).toBeNull();
    });
  });

  describe('短视频', () => {
    it('竖屏 + ≤60 秒', () => {
      expect(classify({ filename: 'clip.mp4', width: 1080, height: 1920, durationSeconds: 30 })?.category).toBe('短视频');
    });

    it('横屏 30 秒不判短视频', () => {
      expect(classify({ filename: 'clip.mp4', durationSeconds: 30 })).toBeNull();
    });
  });

  describe('宁可不判', () => {
    it('普通 2 分钟横屏视频 → null（不打标签）', () => {
      expect(classify({ filename: 'VID_20240101.mp4', durationSeconds: 137 })).toBeNull();
    });

    it('空文件名不崩', () => {
      expect(() => classify({ filename: '' })).not.toThrow();
    });
  });
});
