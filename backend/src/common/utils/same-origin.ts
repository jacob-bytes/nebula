import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * 写语义端点的同源校验（CSRF 纵深防御）。
 *
 * 规则：
 * - 浏览器跨站请求必带 `Origin`（POST 一定携带），无 Origin 时按既有策略回退 `Referer`；
 * - 仅比对 host（忽略 scheme，兼容反向代理终止 TLS 的部署）；
 * - 允许的 host 集合 = 请求自身 host + CORS_ORIGINS / FRONTEND_URL / APP_URL 中的 host，
 *   以兼容前后端分离部署（例如开发期 Vite 5173 代理到后端 3000）；
 * - 无 Origin/Referer 的非浏览器客户端（API Key / Bearer 脚本调用）放行——它们不受
 *   浏览器同源策略约束，也不携带可被利用的 Cookie，仍由认证与权限校验保护。
 */
export function assertSameOriginWrite(req: Request): void {
  const raw = (req.headers['origin'] as string | undefined)
    ?? (req.headers['referer'] as string | undefined);
  if (!raw) return;
  let originHost: string | undefined;
  try {
    originHost = new URL(raw).host;
  } catch {
    throw new ForbiddenException('非法的 Origin/Referer');
  }
  if (!originHost) return;

  // 与请求自身的 Host 头比较（含端口）。
  // 不能用 req.hostname：Express 会剥掉端口，导致 `http://1.2.3.4:3000` 这类
  // 直接用 IP+端口访问的部署被判为跨站（真实踩过：向导页「发送测试消息」403）。
  if (requestHostMatches(req, raw)) return;
  if (isConfiguredCorsHost(originHost)) return;
  throw new ForbiddenException('跨站请求被拒绝');
}

function sameHostnameOnly(rawOrigin: string, hostname: string): boolean {
  try {
    return new URL(rawOrigin).hostname === hostname;
  } catch {
    return false;
  }
}

/** 归一化端口：http 省略 80、https 省略 443，使 `example.com` 与 `example.com:443` 等价 */
function normalizePort(protocol: string, port: string): string {
  if (port) return port;
  return protocol === 'https:' ? '443' : '80';
}

/**
 * 判断 Origin/Referer 是否与「本次请求实际访问的地址」同源。
 *
 * 依据请求的 Host 头（含端口）与协议推断请求方看到的地址，再与 Origin 比对。
 * 只信任 Host 头是安全的：攻击者伪造 Host 也只能把自己的 Origin 判成合法，
 * 而跨站攻击的关键是「受害者的 Origin 与目标站不同」，无法借此绕过。
 */
function requestHostMatches(req: Request, rawOrigin: string): boolean {
  const hostHeader = (req.headers.host ?? '').trim();
  // 真实请求必有 Host；单元测试里的请求对象可能只有 hostname，退化为主机名比较
  if (!hostHeader) return Boolean(req.hostname) && sameHostnameOnly(rawOrigin, req.hostname);
  let originUrl: URL;
  try {
    originUrl = new URL(rawOrigin);
  } catch {
    return false;
  }
  const protocol = (req.protocol || 'http').toLowerCase();
  const requestProtocol = protocol === 'https' ? 'https:' : 'http:';
  // ReferenceError 防御：Host 头可能是 `host:port` 也可能是裸 `host`
  const [requestHostname, requestPortRaw = ''] = hostHeader.split(':');
  if (!requestHostname) return false;

  return originUrl.hostname === requestHostname
    && normalizePort(originUrl.protocol, originUrl.port)
      === normalizePort(requestProtocol, requestPortRaw);
}

/** 判断 host 是否属于显式配置允许的跨源来源（CORS_ORIGINS / FRONTEND_URL / APP_URL）。 */
export function isConfiguredCorsHost(host: string): boolean {
  const configured: string[] = [];
  const push = (value?: string) => {
    for (const entry of (value ?? '').split(',')) {
      const trimmed = entry.trim();
      if (trimmed) configured.push(trimmed);
    }
  };
  push(process.env.CORS_ORIGINS);
  push(process.env.FRONTEND_URL);
  push(process.env.APP_URL);
  for (const origin of configured) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {
      // 配置项非法时忽略（env-validation 已对关键项做格式校验）
    }
  }
  return false;
}
