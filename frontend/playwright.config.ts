import { defineConfig, devices } from '@playwright/test';

/**
 * 浏览器 E2E 配置。
 *
 * 与后端 jest 的分工：jest 验证「函数与接口契约」，这里验证「真实浏览器里点得通」——
 * 登录态、SPA 路由、渲染与分享页这类只有跑起来才知道的问题。
 *
 * 默认行为：自动拉起一个 SQLite + 内置测试数据的后端（scripts/e2e/serve.sh），
 * 跑完即销毁。已有服务时用 E2E_BASE_URL 指过去，配置会自动跳过 webServer。
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3999';

export default defineConfig({
  testDir: './e2e',
  // 单个用例覆盖一条主链路；真出问题时要的是截图与 trace，不是更多并发
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // 本机无 root/sandbox 或内置浏览器异常时，可 E2E_CHANNEL=chrome 改用系统 Chrome
      ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
      launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    },
  }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'bash ../scripts/e2e/serve.sh',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
