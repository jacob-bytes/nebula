<template>
  <header class="app-header">
    <!-- 左：移动端菜单 / 桌面折叠按钮 + 分隔线 + 面包屑 -->
    <div class="header-left">
      <button
        v-if="isMobile"
        type="button"
        class="icon-btn"
        aria-label="打开菜单"
        @click="emit('open-drawer')"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>

      <button
        v-else
        type="button"
        class="icon-btn collapse-btn"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="emit('toggle-collapse')"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="{ 'is-collapsed': collapsed }"
          aria-hidden="true"
        >
          <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
          <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" />
          <path d="M12.5 8l-2 2 2 2" />
        </svg>
      </button>

      <!-- 竖分隔线：把「导航开关」与「位置信息」分开，避免两者挤成一组 -->
      <span class="header-divider" aria-hidden="true"></span>

      <nav class="breadcrumbs" aria-label="面包屑">
        <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.label}-${index}`">
          <span v-if="index > 0" class="crumb-sep" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 5l5 5-5 5" />
            </svg>
          </span>
          <router-link v-if="crumb.to" :to="crumb.to" class="crumb crumb-link">{{ crumb.label }}</router-link>
          <span v-else class="crumb crumb-current" aria-current="page">{{ crumb.label }}</span>
        </template>
      </nav>
    </div>

    <!-- 右：账号与退出（原侧栏底部区域迁到这里） -->
    <div class="header-right">
      <t-dropdown :options="userMenuOptions" trigger="click" placement="bottom-right" @click="onUserMenuClick">
        <button type="button" class="user-trigger" aria-label="账号菜单">
          <span class="user-avatar">{{ avatarLetter }}</span>
          <span class="user-meta">
            <span class="user-email" :title="email">{{ email }}</span>
            <span class="user-role">{{ roleText }}</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </button>
      </t-dropdown>
    </div>
  </header>
</template>

<script setup lang="ts">
import type { BreadcrumbItem } from '../composables/useBreadcrumbs';

defineProps<{
  breadcrumbs: BreadcrumbItem[];
  collapsed: boolean;
  isMobile: boolean;
  email: string;
  roleText: string;
  avatarLetter: string;
}>();

const emit = defineEmits<{
  'toggle-collapse': [];
  'open-drawer': [];
  'open-settings': [];
  logout: [];
}>();

/** 账号菜单：只放「账号相关」，页面级操作仍在各自页面里 */
const userMenuOptions = [
  { content: '个人设置', value: 'settings' },
  { content: '退出登录', value: 'logout' },
];

function onUserMenuClick(data: { value?: string }): void {
  if (data?.value === 'settings') {
    emit('open-settings');
    return;
  }
  if (data?.value === 'logout') {
    emit('logout');
  }
}
</script>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--background) 88%, transparent);
  backdrop-filter: blur(8px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.icon-btn:hover {
  background: var(--muted);
  color: var(--text-primary);
}

.icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.collapse-btn svg {
  transition: transform 0.2s ease;
}

.collapse-btn svg.is-collapsed {
  transform: scaleX(-1);
}

/* 竖分隔线：低对比度，只做视觉分组 */
.header-divider {
  width: 1px;
  height: 18px;
  flex: none;
  background: var(--border-default);
  margin: 0 2px;
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
  color: var(--text-tertiary);
  overflow: hidden;
}

.crumb {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb-link {
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color 0.15s ease;
}

.crumb-link:hover {
  color: var(--text-primary);
}

/* 当前页：加重字重而不是加粗颜色，保持整体克制 */
.crumb-current {
  color: var(--text-primary);
  font-weight: 600;
}

.crumb-sep {
  display: inline-flex;
  color: var(--text-tertiary);
  opacity: 0.7;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.user-trigger:hover {
  background: var(--muted);
  border-color: var(--border-default);
}

.user-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex: none;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
  min-width: 0;
}

.user-email {
  font-size: 13px;
  color: var(--text-primary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 移动端：账号只留头像，面包屑允许压缩 */
@media (max-width: 640px) {
  .app-header {
    padding: 0 12px;
    height: 52px;
  }

  .user-meta,
  .header-divider {
    display: none;
  }

  .breadcrumbs {
    font-size: 13px;
  }
}
</style>
