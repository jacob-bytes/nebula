import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, BREADCRUMB_MAP, NAV_SECTIONS, WORKSPACE_NAV } from './nav';
import { PAGE_ROLES } from '../utils/permissions';

/**
 * 单一事实来源的守卫：侧栏与面包屑共用 config/nav.ts。
 * 这些断言保证「新增页面 / 改权限」时两边不会各走各的。
 */
describe('导航配置（唯一事实来源）', () => {
  it('每个导航项的权限都来自 PAGE_ROLES（不会出现空权限、点了进不去）', () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        expect(item.roles.length, `${item.to} 缺少 PAGE_ROLES 登记`).toBeGreaterThan(0);
        expect(item.roles).toEqual(PAGE_ROLES[item.to]);
      }
    }
  });

  it('面包屑标签与侧栏标签完全一致（派生而非复制）', () => {
    for (const item of [...WORKSPACE_NAV, ...ADMIN_NAV]) {
      const crumb = BREADCRUMB_MAP[item.to];
      expect(crumb, `${item.to} 缺少面包屑`).toBeTruthy();
      expect(crumb.label).toBe(item.label);
    }
  });

  it('管理区块的页面在面包屑里可点击回到 /admin', () => {
    for (const item of ADMIN_NAV) {
      expect(BREADCRUMB_MAP[item.to]?.sectionTo).toBe('/admin');
    }
  });

  it('工作区块没有落地页，区块文本不可点击', () => {
    for (const item of WORKSPACE_NAV) {
      expect(BREADCRUMB_MAP[item.to]?.sectionTo).toBeUndefined();
    }
  });

  it('PAGE_ROLES 中的每个路径都有面包屑（含侧栏之外的页面）', () => {
    const missing = Object.keys(PAGE_ROLES).filter((path) => !BREADCRUMB_MAP[path]);
    expect(missing).toEqual([]);
  });

  it('导航项路径不重复', () => {
    const all = [...WORKSPACE_NAV, ...ADMIN_NAV].map((item) => item.to);
    expect(new Set(all).size).toBe(all.length);
  });
});
