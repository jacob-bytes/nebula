import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { assertSameOriginWrite } from './same-origin';

/**
 * 同源校验的关键回归：**必须容忍端口**。
 *
 * 曾经的 bug：拿 Origin（含端口）与 `req.hostname`（Express 会剥掉端口）比较，
 * 导致「直接用 IP+端口访问、未配置反向代理」的部署里所有写请求被判跨站，
 * 首次运行向导点「发送测试消息」直接 403「跨站请求被拒绝」。
 */
function reqOf(headers: Record<string, string>, protocol = 'http'): Request {
  return { headers, hostname: (headers.host ?? '').split(':')[0], protocol } as unknown as Request;
}

const saved = { CORS_ORIGINS: process.env.CORS_ORIGINS, APP_URL: process.env.APP_URL, FRONTEND_URL: process.env.FRONTEND_URL };

describe('assertSameOriginWrite', () => {
  beforeEach(() => {
    // 隔离环境：不依赖 runner 上的配置
    delete process.env.CORS_ORIGINS;
    delete process.env.APP_URL;
    delete process.env.FRONTEND_URL;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('IP + 非默认端口直接访问：同源通过（核心回归）', () => {
    const req = reqOf({ host: '1.2.3.4:3000', origin: 'http://1.2.3.4:3000' });
    expect(() => assertSameOriginWrite(req)).not.toThrow();
  });

  it('域名 + 端口：同源通过', () => {
    const req = reqOf({ host: 'pan.example.com:8080', origin: 'http://pan.example.com:8080' });
    expect(() => assertSameOriginWrite(req)).not.toThrow();
  });

  it('默认端口等价：Origin 省略 443 与 Host 的 443 视为同源', () => {
    const req = reqOf({ host: 'pan.example.com:443', origin: 'https://pan.example.com' }, 'https');
    expect(() => assertSameOriginWrite(req)).not.toThrow();
  });

  it('不同端口视为跨源，拒绝', () => {
    const req = reqOf({ host: '1.2.3.4:3000', origin: 'http://1.2.3.4:3001' });
    expect(() => assertSameOriginWrite(req)).toThrow(ForbiddenException);
  });

  it('不同主机视为跨源，拒绝', () => {
    const req = reqOf({ host: '1.2.3.4:3000', origin: 'http://evil.example:3000' });
    expect(() => assertSameOriginWrite(req)).toThrow(ForbiddenException);
  });

  it('配置了 CORS_ORIGINS 的前后端分离部署仍然放行', () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';
    const req = reqOf({ host: '127.0.0.1:3000', origin: 'http://localhost:5173' });
    expect(() => assertSameOriginWrite(req)).not.toThrow();
  });

  it('无 Origin/Referer 的脚本调用放行（Bearer / API Key）', () => {
    expect(() => assertSameOriginWrite(reqOf({ host: '1.2.3.4:3000' }))).not.toThrow();
  });

  it('非法 Origin 直接拒绝', () => {
    expect(() => assertSameOriginWrite(reqOf({ host: '1.2.3.4:3000', origin: 'not-a-url' }))).toThrow(ForbiddenException);
  });
});
