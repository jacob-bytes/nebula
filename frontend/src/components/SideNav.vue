<template>
  <div class="sidenav">
    <div class="sidebar-logo">
      <h2>
        <span class="logo-icon" v-html="ICONS.logo"></span>
        <span class="sidebar-title" :title="siteTitle">{{ siteTitle }}</span>
      </h2>
    </div>

    <!-- 区块标题与条目都来自 config/nav.ts：与顶栏面包屑共用同一份数据 -->
    <nav class="sidebar-nav">
      <template v-for="section in visibleSections" :key="section.key">
        <div class="nav-section">{{ section.title }}</div>
        <router-link
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
          :title="collapsed ? item.label : undefined"
          @click="emit('navigate')"
        >
          <span class="nav-icon" v-html="item.icon"></span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </template>
    </nav>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { UserRole } from '../types/user';
import { hasAnyRole } from '../utils/permissions';
import { ICONS, NAV_SECTIONS } from '../config/nav';
import { usePublicConfigStore } from '../stores/public-config';

const props = defineProps<{
  role: UserRole;
  /** 桌面栏折叠态：只留图标，名称走 title 提示 */
  collapsed?: boolean;
}>();

// 账号信息与退出登录已迁到顶栏（AppHeader），侧栏不再承担账号相关操作
const emit = defineEmits<{
  navigate: [];
}>();

const route = useRoute();

/** 网站标题来自公共配置 store：启动初始化与设置页保存共同维护，桌面 / 移动侧栏自动共用 */
const siteTitle = computed(() => usePublicConfigStore().siteTitle);

/**
 * 高亮判断：精确匹配或子路由前缀匹配。
 * 例如 /files 会高亮 /files/:id；普通用户仪表盘不会误高亮管理后台页面。
 */
function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + '/');
}

/**
 * 图标统一为 currentColor 描边 SVG，随 nav-item 状态变色。
 *
 * L4 约束（不可放宽）：`v-html` 仅允许渲染下方代码内常量字符串。
 * 严禁把用户输入、接口返回或远程内容传入 `svg()`/`v-html`——一旦来源动态化即构成 XSS。
 * 需要动态图标时改用组件渲染，不得拼接 HTML 字符串。
 */
/** 可见区块：按角色过滤条目，整块为空时连标题一起隐藏 */
const visibleSections = computed(() =>
  NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((navItem) => hasAnyRole(props.role, navItem.roles)),
    }))
    .filter((section) => section.items.length > 0),
);
</script>

<style scoped>
.sidenav {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 底部账号区已迁到顶栏：导航本体接管整个可用高度并自行滚动 */
.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 16px;
}
</style>
