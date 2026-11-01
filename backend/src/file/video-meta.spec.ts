import {
  AUTO_TAG_PREFIX,
  autoTagColor,
  deriveVideoTags,
  durationLabel,
  parseFfprobeOutput,
  qualityLabel,
} from './video-meta';

/** 真实 ffprobe 输出的裁剪版（1080p H.264 + 音轨，时长 137 秒） */
const SAMPLE = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '137.24', bit_rate: '4820000' },
});

describe('ffprobe 输出解析', () => {
  it('解析出时长/分辨率/编码/音轨/码率/帧率', () => {
    const meta = parseFfprobeOutput(SAMPLE);
    expect(meta).toEqual({
      durationSeconds: 137,
      width: 1920,
      height: 1080,
      codec: 'H.264',
      hasAudio: true,
      bitrateKbps: 4820,
      frameRate: 29.97,
    });
  });

  it('无视频流（纯音频容器）返回 null', () => {
    expect(parseFfprobeOutput(JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
      format: { duration: '10' },
    }))).toBeNull();
  });

  it('坏 JSON / 缺宽高 返回 null，不抛错', () => {
    expect(parseFfprobeOutput('not json')).toBeNull();
    expect(parseFfprobeOutput(JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 0, height: 0 }],
    }))).toBeNull();
  });

  it('未知编码保留原始标识并大写，不猜', () => {
    const meta = parseFfprobeOutput(JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'weirdcodec', width: 640, height: 360 }],
      format: { duration: '5' },
    }));
    expect(meta?.codec).toBe('WEIRDCODEC');
  });

  it('帧率为 0/0 时不产生 Infinity', () => {
    const meta = parseFfprobeOutput(JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '0/0' }],
      format: { duration: '5' },
    }));
    expect(meta?.frameRate).toBeNull();
  });
});

describe('标签推导', () => {
  const base = { durationSeconds: 137, width: 1920, height: 1080, codec: 'H.264', hasAudio: true, bitrateKbps: 4820, frameRate: 30 };

  it('画质按短边判定（竖屏 1080x1920 仍是 1080p）', () => {
    expect(qualityLabel({ width: 1080, height: 1920 })).toBe('1080p');
    expect(qualityLabel({ width: 3840, height: 2160 })).toBe('4K');
    expect(qualityLabel({ width: 1280, height: 720 })).toBe('720p');
    expect(qualityLabel({ width: 640, height: 360 })).toBe('SD');
  });

  it('时长档位边界', () => {
    expect(durationLabel(59)).toBe('短视频');
    expect(durationLabel(60)).toBe('中等视频');
    expect(durationLabel(1199)).toBe('中等视频');
    expect(durationLabel(1200)).toBe('长视频');
  });

  it('产出三个带前缀的标签', () => {
    expect(deriveVideoTags(base)).toEqual([
      `${AUTO_TAG_PREFIX}1080p`,
      `${AUTO_TAG_PREFIX}H.264`,
      `${AUTO_TAG_PREFIX}中等视频`,
    ]);
  });

  it('自动标签配色按维度区分且始终是合法色值', () => {
    for (const name of deriveVideoTags(base)) {
      expect(autoTagColor(name)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(autoTagColor(`${AUTO_TAG_PREFIX}4K`)).not.toBe(autoTagColor(`${AUTO_TAG_PREFIX}长视频`));
  });
});
