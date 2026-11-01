import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { BREADCRUMB_MAP } from '../config/nav';

/**
 * 面包屑：把「当前路由」翻译成 `区块 › 页面` 两级。
 *
 * 数据来源是 `config/nav.ts` 的 NAV_SECTIONS（与侧栏同一份）：
 * 改名只需改一处，不会出现「侧栏叫 A、面包屑叫 B」的漂移。
 * 侧栏之外的页面（如仪表盘定制）在 nav.ts 的 EXTRA_CRUMBS 里补充。
 */
export interface BreadcrumbItem {
  label: string;
  /** 可点击的上级；当前页（最后一项）不带 to */
  to?: string;
}

/** 重新导出，便于测试与调试（数据源仍在 config/nav.ts） */
export { BREADCRUMB_MAP };

/**
 * 生成面包屑项。
 *
 * 匹配规则：先精确匹配，再按「最长前缀」回退（例如未来出现 /admin/users/:id 这类
 * 子路由时仍能落到父级面包屑，而不是空白）。
 */
export function resolveBreadcrumbs(path: string): BreadcrumbItem[] {
  const exact = BREADCRUMB_MAP[path];
  if (exact) {
    return [
      ...(exact.sectionTo
        ? [{ label: exact.section, to: exact.sectionTo }]
        : [{ label: exact.section }]),
      { label: exact.label },
    ];
  }

  let best = '';
  for (const key of Object.keys(BREADCRUMB_MAP)) {
    if (path.startsWith(`${key}/`) && key.length > best.length) {
      best = key;
    }
  }
  if (best) {
    const entry = BREADCRUMB_MAP[best]!;
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
