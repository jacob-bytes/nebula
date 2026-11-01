// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const issueTicket = vi.fn(async () => 'ticket-abc');
vi.mock('../../utils/preview', () => ({
  issueFileMediaTicket: (...args: unknown[]) => issueTicket(...(args as [])),
  buildFileMediaTicketUrl: (ticket: string) => `/api/files/media-ticket?ticket=${ticket}`,
}));

import VideoHoverPopover from './VideoHoverPopover.vue';

function setMediaQueries(opts: { hover: boolean; reduceMotion?: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('hover: hover') ? opts.hover : Boolean(opts.reduceMotion),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const mountPopover = () => mount(VideoHoverPopover, {
  props: { fileId: 'file-1', mimeType: 'video/mp4' },
  slots: { default: '<span class="thumb-slot">thumb</span>' },
  attachTo: document.body,
});

beforeEach(() => {
  setMediaQueries({ hover: true });
  issueTicket.mockClear();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { value: vi.fn(), configurable: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('视频行悬停预览浮层', () => {
  it('延迟 320ms 才请求票据（扫过列表不会连发请求）', async () => {
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    expect(issueTicket).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(360);
    await nextTick();
    expect(issueTicket).toHaveBeenCalledWith('file-1');
    expect(document.querySelector('.hover-panel')).not.toBeNull();
    expect(document.querySelector('.hover-video')).not.toBeNull();
  });

  it('移开指针后销毁浮层并清空 src（中断在途请求）', async () => {
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(360);
    await nextTick();
    expect(document.querySelector('.hover-video')).not.toBeNull();

    await wrapper.find('.hover-trigger').trigger('mouseleave');
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();
    expect(document.querySelector('.hover-panel')).toBeNull();
  });

  it('指针从缩略图移到浮层时保持打开', async () => {
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(360);
    await nextTick();

    await wrapper.find('.hover-trigger').trigger('mouseleave');
    const panel = document.querySelector('.hover-panel') as HTMLElement;
    panel.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('.hover-panel')).not.toBeNull();
  });

  it('票据签发失败时显示「无法预览」，不抛错', async () => {
    issueTicket.mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(360);
    await nextTick();
    expect(document.querySelector('.hover-video')).toBeNull();
    expect(document.querySelector('.hover-panel')?.textContent).toContain('无法预览');
  });

  it('触屏设备不请求票据', async () => {
    setMediaQueries({ hover: false });
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(360);
    expect(issueTicket).not.toHaveBeenCalled();
  });

  it('开启减少动效时不请求票据', async () => {
    setMediaQueries({ hover: true, reduceMotion: true });
    const wrapper = mountPopover();
    await wrapper.find('.hover-trigger').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(360);
    expect(issueTicket).not.toHaveBeenCalled();
  });
});
