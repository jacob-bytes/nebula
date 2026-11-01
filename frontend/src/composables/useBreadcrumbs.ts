import { computed } from 'vue';
import { useRoute } from 'vue-router';

/**
 * 面包屑：把「当前路由」翻译成 `区块 › 页面` 两级。
 *
 * 为什么单独维护一张表而不是读路由 meta：
 * 路由表里的 meta 只承载权限（superAdmin），标题散落在各页面的 `<h1>` 里，
 * 直接复用会得到「仪表盘 › 仪表盘」这类重复。集中一张表还能被测试守住
 * （见 useBreadcrumbs.spec.ts：新增路由若忘记登记会立刻失败）。
 */
export interface BreadcrumbItem {
  label: string;
  /** 可点击的上级；当前页（最后一项）不带 to */
  to?: string;
}

interface CrumbEntry {
  section: string;
  label: string;
  /** 区块本身的落地页，用于让第一级可点击 */
  sectionTo?: string;
}

const CRUMBS: Record<string, CrumbEntry> = {
  '/dashboard': { section: '工作区', label: '仪表盘' },
  '/files': { section: '工作区', label: '我的文件' },
  '/shares': { section: '工作区', label: '我的分享' },
  '/settings': { section: '工作区', label: '个人设置' },

  '/admin': { section: '管理后台', label: '概览', sectionTo: '/admin' },
  '/admin/users': { section: '管理后台', label: '用户管理', sectionTo: '/admin' },
  '/admin/files': { section: '管理后台', label: '文件管理', sectionTo: '/admin' },
  '/admin/access-logs': { section: '管理后台', label: '访问统计', sectionTo: '/admin' },
  '/admin/security': { section: '管理后台', label: '安全监控', sectionTo: '/admin' },
  '/admin/user-activity': { section: '管理后台', label: '用户活跃', sectionTo: '/admin' },
  '/admin/audit-logs': { section: '管理后台', label: '操作审计', sectionTo: '/admin' },
  '/admin/telegram-accounts': { section: '管理后台', label: 'Telegram 账号池', sectionTo: '/admin' },
  '/admin/config': { section: '管理后台', label: '系统配置', sectionTo: '/admin' },
  '/admin/dashboard-customizer': { section: '管理后台', label: '仪表盘定制', sectionTo: '/admin' },
  '/admin/design-system': { section: '管理后台', label: '设计规范', sectionTo: '/admin' },
};

/** 供测试与调试：导出一份路由→面包屑的只读映射 */
export const BREADCRUMB_MAP: Readonly<Record<string, CrumbEntry>> = CRUMBS;

/**
 * 生成面包屑项。
 *
 * 匹配规则：先精确匹配，再按「最长前缀」回退（例如未来出现 /admin/users/:id 这类
 * 子路由时仍能落到父级面包屑，而不是空白）。
 */
export function resolveBreadcrumbs(path: string): BreadcrumbItem[] {
  const exact = CRUMBS[path];
  if (exact) {
    return [
      ...(exact.sectionTo
        ? [{ label: exact.section, to: exact.sectionTo }]
        : [{ label: exact.section }]),
      { label: exact.label },
    ];
  }

  let best = '';
  for (const key of Object.keys(CRUMBS)) {
    if (path.startsWith(`${key}/`) && key.length > best.length) {
      best = key;
    }
  }
  if (best) {
    const entry = CRUMBS[best]!;
    return [
      ...(entry.sectionTo
        ? [{ label: entry.section, to: entry.sectionTo }]
        : [{ label: entry.section }]),
      { label: entry.label },
    ];
  }
  return [];
}

/** 路由响应式版本：Layout 的头部直接用它渲染 */
export function useBreadcrumbs() {
  const route = useRoute();
  return computed<BreadcrumbItem[]>(() => {
    // 文件夹深层路径（/files 下由前端状态管理）不影响面包屑：路径本身是页面级
    const path = route.path.replace(/\/+$/, '') || '/dashboard';
    return resolveBreadcrumbs(path);
  });
}
