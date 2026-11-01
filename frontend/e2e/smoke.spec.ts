import { expect, test } from '@playwright/test';

/**
 * 主链路冒烟：登录 → 文件列表 → 分享页 → 服务端 OG。
 *
 * 只覆盖「浏览器里才暴露」的契约：Cookie 会话、SPA 路由、真实渲染。
 * 更细的业务规则留给后端 jest 与组件测试，避免这里变成慢而脆的全量回归。
 */

const ADMIN = { email: 'e2e-admin@example.com', password: 'E2ePassw0rd!' };
const SHARE_TOKEN = 'e2eshare01';

test.describe('星云盘主链路', () => {
  test('未登录访问受保护页面会被引导到登录页', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /登录|欢迎回来/ })).toBeVisible();
  });

  test('管理员可以登录并进入仪表盘', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(ADMIN.email);
    await page.locator('input[type="password"]').first().fill(ADMIN.password);
    await page.getByRole('button', { name: /登录/ }).first().click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    // 侧边栏与页面标题渲染出来即视为登录态生效
    await expect(page.getByRole('link', { name: '我的文件' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  });

  test('文件列表渲染出种子数据', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(ADMIN.email);
    await page.locator('input[type="password"]').first().fill(ADMIN.password);
    await page.getByRole('button', { name: /登录/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto('/files');
    await expect(page.getByText('E2E 验证文件.pdf').first()).toBeVisible({ timeout: 15_000 });
  });

  test('公开分享页展示文件信息与下载入口', async ({ page }) => {
    await page.goto(`/s/${SHARE_TOKEN}`);
    await expect(page.getByText('E2E 验证文件.pdf').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /下载文件/ })).toBeVisible();
    await expect(page.getByText(/由 星云盘 分享/)).toBeVisible();
  });

  test('分享页返回带 Open Graph 的服务端 HTML', async ({ request }) => {
    const response = await request.get(`/s/${SHARE_TOKEN}`, {
      headers: { Accept: 'text/html' },
    });
    expect(response.status()).toBe(200);
    const html = await response.text();
    // 爬虫看到的必须是真实标题，而不是 SPA 的通用标题
    expect(html).toContain('property="og:title" content="E2E 验证文件.pdf"');
    expect(html).toContain('property="og:image"');
    // 不允许出现两份 og:title（默认标签必须被区域替换掉）
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });
});
