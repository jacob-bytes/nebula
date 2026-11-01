<template>
  <!-- 触发器：包住行内缩略图，悬停后在其右侧浮出小播放器 -->
  <span class="hover-trigger" @mouseenter="onEnter" @mouseleave="onLeave">
    <slot />
  </span>

  <Teleport to="body">
    <div
      v-if="panelVisible"
      ref="panelEl"
      class="hover-panel"
      :style="panelStyle"
      aria-hidden="true"
      @mouseenter="cancelClose"
      @mouseleave="onLeave"
    >
      <video
        v-if="src"
        ref="videoEl"
        class="hover-video"
        :src="src"
        muted
        playsinline
        autoplay
        preload="metadata"
        @timeupdate="onTimeUpdate"
        @error="onVideoError"
      ></video>
      <span v-else class="panel-hint">{{ state === 'unavailable' ? '无法预览' : '预览加载中…' }}</span>
      <span class="panel-meta">{{ durationLabel }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { buildFileMediaTicketUrl, issueFileMediaTicket } from '../../utils/preview';

/**
 * 视频行的悬停预览：浮层里播原文件的前几秒。
 *
 * 为什么是浮层而不是行内播放：行内缩略图只有 36px，塞进去看不清。
 * 浮层用 Teleport 挂到 body，避免被表格/滚动容器的 overflow 裁掉。
 *
 * 成本与边界（方案 A）：
 * - 直接拉原视频，靠 Range 只取前面一段；冷文件首字节要等回源，期间显示「预览加载中」；
 * - 播满 6 秒自动停；指针移开立刻销毁 src，中断在途请求；
 * - 仅在「精确指针 + 可悬停 + 未开启减少动效 + 未开启省流量」时启用。
 */
const props = withDefaults(defineProps<{
  fileId: string;
  mimeType: string;
  /** 浮层相对触发器的水平偏移（默认贴右侧） */
  offsetX?: number;
}>(), {
  offsetX: 12,
});

const MAX_PREVIEW_SECONDS = 6;
const HOVER_DELAY_MS = 320;
const CLOSE_DELAY_MS = 140;
const TICKET_TTL_MS = 20_000;
const PANEL_WIDTH = 264;
const PANEL_HEIGHT = 158;

type State = 'idle' | 'loading' | 'playing' | 'unavailable';

const state = ref<State>('idle');
const src = ref<string>('');
const panelVisible = ref(false);
const panelEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const panelPos = ref({ top: 0, left: 0 });

let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let ticketCache: { url: string; expiresAt: number } | null = null;
let loadToken = 0;

const durationLabel = computed(() =>
  state.value === 'playing' ? `预览 ${MAX_PREVIEW_SECONDS} 秒` : '视频',
);

const panelStyle = computed(() => ({
  top: `${panelPos.value.top}px`,
  left: `${panelPos.value.left}px`,
  width: `${PANEL_WIDTH}px`,
  height: `${PANEL_HEIGHT}px`,
}));

function canPreview(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
}

/**
 * 浮层定位：贴在**所在行**的右侧，而不是紧挨 36px 缩略图。
 * 紧贴缩略图会盖住文件名与大小，视觉上像是错位；贴行右侧既露出内容，也靠近尺寸列。
 * 行容器不存在时（例如被单独使用）退回触发器锚点。
 */
function positionPanel(anchor: HTMLElement): void {
  const row = anchor.closest('.os-row') as HTMLElement | null;
  const anchorRect = anchor.getBoundingClientRect();
  const hostRect = row ? row.getBoundingClientRect() : anchorRect;

  const gap = props.offsetX;
  const rightCandidate = Math.min(
    window.innerWidth - PANEL_WIDTH - 12,
    hostRect.right - PANEL_WIDTH - gap,
  );
  const left = Math.max(8, rightCandidate);

  const top = Math.min(
    Math.max(8, anchorRect.top + anchorRect.height / 2 - PANEL_HEIGHT / 2),
    window.innerHeight - PANEL_HEIGHT - 8,
  );
  panelPos.value = { top, left };
}

async function openPreview(anchor: HTMLElement): Promise<void> {
  positionPanel(anchor);
  panelVisible.value = true;

  const token = ++loadToken;
  state.value = 'loading';
  try {
    if (!ticketCache || ticketCache.expiresAt <= Date.now()) {
      const ticket = await issueFileMediaTicket(props.fileId);
      ticketCache = { url: buildFileMediaTicketUrl(ticket), expiresAt: Date.now() + TICKET_TTL_MS };
    }
    if (token !== loadToken) return;
    src.value = ticketCache.url;
    state.value = 'playing';
  } catch (error) {
    if (token !== loadToken) return;
    state.value = 'unavailable';
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
      console.warn('[video-hover] 预览失败：', error);
    }
  }
}

function closePreview(): void {
  loadToken += 1;
  if (openTimer !== null) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  panelVisible.value = false;
  state.value = 'idle';
  // 清空 src 才会中断在途请求
  src.value = '';
}

function onEnter(event: MouseEvent): void {
  cancelClose();
  if (panelVisible.value || openTimer !== null) return;
  if (!canPreview()) return;
  const anchor = event.currentTarget as HTMLElement | null;
  if (!anchor) return;
  openTimer = setTimeout(() => {
    openTimer = null;
    void openPreview(anchor);
  }, HOVER_DELAY_MS);
}

function onLeave(): void {
  if (openTimer !== null) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  // 稍等再关：给指针从缩略图移到浮层留出时间
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closePreview();
  }, CLOSE_DELAY_MS);
}

function cancelClose(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function onTimeUpdate(): void {
  const video = videoEl.value;
  if (!video) return;
  if (video.currentTime >= MAX_PREVIEW_SECONDS) closePreview();
}

function onVideoError(): void {
  state.value = 'unavailable';
  src.value = '';
}

onBeforeUnmount(() => {
  loadToken += 1;
  if (openTimer !== null) clearTimeout(openTimer);
  if (closeTimer !== null) clearTimeout(closeTimer);
  ticketCache = null;
});
</script>

<style scoped>
.hover-trigger {
  display: inline-flex;
}

.hover-panel {
  position: fixed;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;
  background: #000;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}

.hover-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.panel-hint {
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
}

.panel-meta {
  position: absolute;
  left: 8px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
  pointer-events: none;
}
</style>
