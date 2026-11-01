import { describe, expect, it } from 'vitest';
import { BREADCRUMB_MAP, resolveBreadcrumbs } from './useBreadcrumbs';
import { PAGE_ROLES } from '../utils/permissions';

/**
 * 面包屑守卫：
 * 1. 每个受权限控制的页面都必须有面包屑条目——否则顶栏会空一块，且没有任何报错；
 * 2. 匹配规则要能兜住子路径。
 */
describe('面包屑解析', () => {
  it('受权限控制的每个页面都登记了面包屑', () => {
    const missing = Object.keys(PAGE_ROLES).filter((path) => !BREADCRUMB_MAP[path]);
    expect(missing).toEqual([]);
  });

  it('工作区页面：区块不可点击，当前页加粗（无 to）', () => {
    expect(resolveBreadcrumbs('/files')).toEqual([
      { label: '工作区' },
      { label: '我的文件' },
    ]);
  });

  it('管理页面：区块可点击回到后台首页', () => {
    expect(resolveBreadcrumbs('/admin/users')).toEqual([
      { label: '管理后台', to: '/admin' },
      { label: '用户管理' },
    ]);
  });

  it('子路径回退到最长前缀父级', () => {
    expect(resolveBreadcrumbs('/admin/users/abc-123')).toEqual([
      { label: '管理后台', to: '/admin' },
      { label: '用户管理' },
    ]);
  });

  it('未知路径返回空数组（顶栏只显示折叠按钮，不显示错误文案）', () => {
    expect(resolveBreadcrumbs('/no-such-page')).toEqual([]);
  });
});
