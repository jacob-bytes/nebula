import type { UserRole } from '../types/user';
import { PAGE_ROLES } from '../utils/permissions';

/**
 * 导航与面包屑的唯一事实来源。
 *
 * 背景：侧栏（SideNav）与顶栏面包屑（useBreadcrumbs）此前各自维护一份「路径 → 名称」，
 * 改名要改两处、漏改靠测试兜底。现在两者都从这里派生：
 *   - 侧栏渲染 NAV_SECTIONS；
 *   - 面包屑由 NAV_SECTIONS 生成 BREADCRUMB_MAP，另加几个不在侧栏里的页面。
 *
 * 约束（不可放宽）：图标是 `v-html` 渲染的内联 SVG 常量。
 * 严禁把用户输入、接口返回或远程内容拼进 ICONS / nav 项——来源一旦动态化即构成 XSS。
 */

const svg = (inner: string): string =>
  `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** 图标：键名与 NavItem.icon 对应；logo 单独供侧栏头部使用 */
export const ICONS = {
  logo: svg('<path d="M10 2L17 6v8l-7 4-7-4V6l7-4z"/><path d="M10 10l7-4M10 10v8M10 10L3 6"/>'),
  dashboard: svg('<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/>'),
  files: svg('<path d="M2 5.5A1.5 1.5 0 013.5 4H8l2 2h6.5A1.5 1.5 0 0118 7.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 15.5v-10z"/>'),
  shares: svg('<circle cx="14" cy="5" r="2.5"/><circle cx="5" cy="10" r="2.5"/><circle cx="14" cy="15" r="2.5"/><path d="M7.2 8.8l4.6-2.6M7.2 11.2l4.6 2.6"/>'),
  settings: svg('<circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.2 4.2l1.4 1.4m8.8 8.8l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"/>'),
  users: svg('<circle cx="7" cy="7" r="3"/><path d="M1 18v-1a4 4 0 014-4h4a4 4 0 014 4v1"/><circle cx="15" cy="7" r="2.5"/><path d="M15 13a4 4 0 014 4v1"/>'),
  adminFiles: svg('<path d="M5 2h7l4 4v10a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M12 2v4h4"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="7" y1="13" x2="11" y2="13"/>'),
  designSystem: svg('<path d="M10 2a8 8 0 100 16c1 0 1.5-.8 1.5-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.6-.5-1.1 0-.8.7-1.5 1.5-1.5H14a4 4 0 004-4c0-3.3-3.6-6-8-6z"/><circle cx="6.5" cy="8" r="1"/><circle cx="10" cy="5.5" r="1"/><circle cx="13.5" cy="8" r="1"/>'),
  config: svg('<line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/><circle cx="7" cy="5" r="1.5" fill="currentColor"/><circle cx="13" cy="10" r="1.5" fill="currentColor"/><circle cx="9" cy="15" r="1.5" fill="currentColor"/>'),
  accessLogs: svg('<circle cx="10" cy="10" r="8"/><polyline points="10 5 10 10 14 12"/>'),
  security: svg('<path d="M10 2L3 5.5v4.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V5.5L10 2z"/><path d="M7 10l2 2 4-4"/>'),
  userActivity: svg('<polyline points="2 10 5 10 7 4 10 16 13 8 15 10 18 10"/>'),
  auditLogs: svg('<rect x="4" y="2" width="12" height="16" rx="2"/><line x1="7" y1="7" x2="13" y2="7"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="7" y1="13" x2="10" y2="13"/>'),
  telegramAccounts: svg('<path d="M18 3L2 9.4l5.8 2.1L10 18l3-4.1L18 3z"/><path d="M7.8 11.5L18 3"/>'),
} as const;

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** 权限来自 PAGE_ROLES（唯一来源），此处不重复声明角色列表 */
  roles: readonly UserRole[];
}

export interface NavSection {
  key: string;
  title: string;
  /** 该区块的落地页：存在时面包屑第一级可点击 */
  landingTo?: string;
  items: NavItem[];
}

const item = (to: string, label: string, icon: string): NavItem => ({
  to,
  label,
  icon,
  roles: PAGE_ROLES[to] ?? [],
});

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: 'workspace',
    title: '工作区',
    items: [
      item('/dashboard', '仪表盘', ICONS.dashboard),
      item('/files', '我的文件', ICONS.files),
      item('/shares', '我的分享', ICONS.shares),
      item('/settings', '个人设置', ICONS.settings),
    ],
  },
  {
    key: 'admin',
    title: '管理后台',
    landingTo: '/admin',
    items: [
      item('/admin/users', '用户管理', ICONS.users),
      item('/admin/files', '文件管理', ICONS.adminFiles),
      item('/admin/access-logs', '访问统计', ICONS.accessLogs),
      item('/admin/security', '安全监控', ICONS.security),
      item('/admin/user-activity', '用户活跃', ICONS.userActivity),
      item('/admin/audit-logs', '操作审计', ICONS.auditLogs),
      item('/admin/telegram-accounts', 'Telegram 账号池', ICONS.telegramAccounts),
      // 系统配置含仅超级管理员可读写的配置，因此仅在完整权限下展示
      item('/admin/design-system', '设计规范', ICONS.designSystem),
      item('/admin/config', '系统配置', ICONS.config),
    ],
  },
] as const;

export const WORKSPACE_NAV: readonly NavItem[] = NAV_SECTIONS[0]!.items;
export const ADMIN_NAV: readonly NavItem[] = NAV_SECTIONS[1]!.items;

export interface CrumbEntry {
  section: string;
  label: string;
  sectionTo?: string;
}

/** 不在侧栏里、但需要面包屑的页面 */
const EXTRA_CRUMBS: Record<string, CrumbEntry> = {
  '/admin': { section: '管理后台', label: '概览', sectionTo: '/admin' },
  '/admin/dashboard-customizer': { section: '管理后台', label: '仪表盘定制', sectionTo: '/admin' },
};

/**
 * 面包屑映射：**由 NAV_SECTIONS 派生**，因此改导航名称不会让面包屑漂移。
 * 侧栏之外的页面补充在 EXTRA_CRUMBS 中。
 */
export const BREADCRUMB_MAP: Readonly<Record<string, CrumbEntry>> = (() => {
  const map: Record<string, CrumbEntry> = { ...EXTRA_CRUMBS };
  for (const section of NAV_SECTIONS) {
    for (const navItem of section.items) {
      map[navItem.to] = {
        section: section.title,
        label: navItem.label,
        ...(section.landingTo ? { sectionTo: section.landingTo } : {}),
      };
    }
  }
  return map;
})();
