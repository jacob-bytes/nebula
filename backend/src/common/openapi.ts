import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 文档生成与挂载。
 *
 * 为什么做这件事：`docs/API.md` 是手写的，接口一改就漂移。这里让文档从
 * 路由与 DTO 直接生成，至少保证「路径 / 方法 / 参数」与代码一致。
 *
 * 默认**关闭**：文档会暴露全部路由与参数结构，生产环境属于信息泄露。
 * 需要时显式 OPENAPI_ENABLED=true 开启（本地开发/自建文档站）。
 *
 * 挂载点：
 *   - GET /api/docs       Swagger UI（交互式）
 *   - GET /api/docs-json  原始 JSON（可被 `docs/openapi.json` 快照比对）
 *
 * 注意：文档会暴露全部路由结构，属于「信息暴露」，但对自建网盘而言可接受；
 * 若部署环境不希望公开，可用 OPENAPI_ENABLED=false 关闭。
 */
export function setupOpenApi(app: INestApplication): void {
  // 默认关闭：宁可默认安全，也不要默认暴露路由结构
  const enabled = (process.env.OPENAPI_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    new Logger('OpenApi').log('OpenAPI 文档未启用（如需开启：OPENAPI_ENABLED=true）');
    return;
  }

  const version = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return String(require('../../package.json').version);
    } catch {
      return '0.0.0';
    }
  })();

  const config = new DocumentBuilder()
    .setTitle('星云盘 API')
    .setDescription(
      '基于 Telegram 的文件分发与网盘系统。所有响应统一为 { code, message, data }；' +
        '认证方式为 HttpOnly Cookie（access_token）或 X-API-Key。',
    )
    .setVersion(version)
    .addCookieAuth('access_token', { type: 'apiKey', in: 'cookie' }, 'access_token')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
    .addTag('auth', '注册 / 登录 / 会话')
    .addTag('files', '文件与上传')
    .addTag('folders', '文件夹')
    .addTag('shares', '分享链接')
    .addTag('admin', '管理后台')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    // 只暴露 /api 前缀下的业务路由，避免把静态资源与内部端点也列进去
    ignoreGlobalPrefix: false,
    operationIdFactory: (controllerKey: string, methodKey: string) => `${controllerKey}_${methodKey}`,
  });

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  });

  const pathCount = Object.keys(document.paths || {}).length;
  new Logger('OpenApi').log(`OpenAPI 文档已挂载：/api/docs（${pathCount} 条路径）`);
}
