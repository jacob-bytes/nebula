<template>
  <div class="file-share-card" :class="{ 'file-share-card--encrypted': isEncrypted }">
    <!-- 预览大区：品牌色柔光 + 居中文件标识 -->
    <div class="file-share-hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <ThumbnailImg
        :file-id="info.id"
        :mime-type="info.mimeType"
        :file-name="info.name"
        :size="128"
        :src="buildShareThumbnailUrl(props.token, props.info.id)"
        :context="`s:${props.token}`"
        :version="info.uploadVersion"
      />
    </div>

    <!-- 内容区 -->
    <div class="file-share-body">
      <h1 class="file-name" :title="info.name">{{ info.name }}</h1>

      <!-- 元信息用 chip 表达，替代原来以「·」串联的裸文本 -->
      <div class="file-share-meta">
        <span class="meta-chip">{{ formatSize(info.size) }}</span>
        <span class="meta-chip" :title="info.mimeType">{{ shortType }}</span>
        <span class="meta-chip">{{ formatDateTime(info.createdAt) }}</span>
        <span v-if="info.expiresAt" class="meta-chip meta-chip--warn">
          {{ formatDateTime(info.expiresAt) }} 到期
        </span>
      </div>

      <div class="security-hint" :class="{ encrypted: isEncrypted }">
        <span class="dot" aria-hidden="true"></span>
        <span>{{ isEncrypted ? '加密分享 · 需密码访问' : '公开分享链接' }}</span>
      </div>

      <div class="file-share-actions">
        <button type="button" class="download-btn" :disabled="downloading" @click="handleDownload">
          <t-icon name="download" />
          <span>{{ downloading ? '下载中...' : '下载文件' }}</span>
        </button>
        <button v-if="previewKind" type="button" class="preview-btn" @click="openPreview">
          <!-- 内联 SVG：TDesign 的 t-icon 字符串名在运行时解析，browse 未能解析出图标，
               与图标精灵是否存在无关（做过 A/B 对照）。内联可保证渲染。 -->
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/>
            <circle cx="10" cy="10" r="2.5"/>
          </svg>
          <span>在线预览</span>
        </button>
      </div>

      <p class="share-foot">
        由 <strong>{{ siteTitle }}</strong> 分享 · 请确认来源可信后再下载
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MessagePlugin from '@/utils/message';
import { triggerBrowserDownload, LARGE_FILE_DOWNLOAD_TIP, isLargeFile } from '@/utils/download';
import { getPreviewKind, buildSharePreviewUrl, buildShareThumbnailUrl } from '@/utils/preview';
import { usePublicConfigStore } from '../../stores/public-config';
import ThumbnailImg from '@/components/ThumbnailImg.vue';
import { useMediaPlaybackStore } from '../../stores/mediaPlayback';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  expiresAt?: string | null;
  uploadVersion?: number;
}

const props = defineProps<{
  info: FileInfo;
  token: string;
  encrypted?: boolean;
}>();

const isEncrypted = computed(() => !!props.encrypted);
const siteTitle = computed(() => usePublicConfigStore().siteTitle);
/** 短类型：优先扩展名，回退 MIME 子类型，避免长 MIME 撑破 chip */
const shortType = computed(() => {
  const ext = props.info.name.includes('.') ? props.info.name.split('.').pop() : '';
  if (ext && ext.length <= 5) return ext.toUpperCase();
  return (props.info.mimeType.split('/')[1] ?? props.info.mimeType).toUpperCase();
});
const previewKind = computed(() => getPreviewKind(props.info.mimeType, props.info.name));
const mediaPlaybackStore = useMediaPlaybackStore();

function openPreview() {
  const kind = previewKind.value;
  if (!kind) return;
  mediaPlaybackStore.open({
    context: { type: 'share', token: props.token, encrypted: props.encrypted },
    item: {
      id: props.info.id,
      name: props.info.name,
      mimeType: props.info.mimeType,
      kind,
      size: props.info.size,
      src: buildSharePreviewUrl(props.token, props.info.id),
      downloadUrl: downloadUrl.value,
      contentVersion: props.info.uploadVersion,
    },
    playlist: [],
    playlistIndex: -1,
  });
}

const downloadUrl = computed(() => `/api/s/${encodeURIComponent(props.token)}/download/${encodeURIComponent(props.info.id)}`);

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

const downloading = ref(false);

/**
 * 分享域下载。
 *
 * 说明（为何不走两阶段「下载任务」流程）：
 * 后端暂未提供分享域（`/api/s/:token`）的下载任务创建端点（任务化创建入口仅存在于
 * 需登录的 `POST /api/files/:id/download-tasks`）。因此这里不伪造接口，改为复用既有
 * 同源下载 URL 直接触发浏览器原生下载，并对大文件提示使用支持断点续传的下载器。
 *
 * 浏览器原生下载器不回传完成状态，故只提示「已开始下载」；不使用 fetch + blob。
 */
function handleDownload() {
  if (downloading.value) return;
  downloading.value = true;
  triggerBrowserDownload(downloadUrl.value, props.info.name);
  MessagePlugin.success(
    isLargeFile(props.info.size) ? LARGE_FILE_DOWNLOAD_TIP : '已开始下载，请查看浏览器下载进度',
  );
  window.setTimeout(() => { downloading.value = false; }, 1000);
}
</script>

<style scoped>
.file-share-card {
  width: 100%;
  background: var(--color-bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-family: var(--font-body);
}

/* 预览大区：品牌色柔光 + 居中文件标识 */
.file-share-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 32px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--border-default);
  overflow: hidden;
}
.hero-glow {
  position: absolute;
  inset: -40% -10% auto;
  height: 220px;
  background: radial-gradient(60% 60% at 50% 40%,
    color-mix(in srgb, var(--seed-primary) 14%, transparent),
    transparent 70%);
  pointer-events: none;
}

.file-share-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.file-name {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.01em;
  word-break: break-all;
}

/* 元信息：chip 组，比「·」串联更易扫读 */
.file-share-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: var(--radius-sm);
  background: var(--muted);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-chip--warn { color: var(--color-warning); }

.security-hint {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 7px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.security-hint .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}
.security-hint.encrypted .dot { background: var(--primary); }

.file-share-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.file-share-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 11px 16px;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-expo),
              border-color var(--duration-fast) var(--ease-out-expo);
}
.download-btn {
  color: var(--primary-foreground);
  background: var(--primary);
  border: 1px solid var(--primary);
}
.download-btn:hover { background: color-mix(in srgb, var(--primary) 88%, var(--foreground)); }
.download-btn:disabled { cursor: not-allowed; opacity: .6; }

.preview-btn {
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-default);
}
.preview-btn:hover { background: var(--accent); color: var(--accent-foreground); border-color: transparent; }

/* 页脚：品牌归属 + 安全提示 */
.share-foot {
  margin: 2px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.share-foot strong { color: var(--text-secondary); font-weight: 600; }

@media (max-width: 480px) {
  .file-share-hero { padding: 28px 16px 24px; }
  .file-share-hero :deep(img) { max-width: 96px; max-height: 96px; }
  .file-share-body { padding: 18px; gap: 12px; }
  .file-name { font-size: 17px; }
  .meta-chip { max-width: 150px; }
}
</style>
