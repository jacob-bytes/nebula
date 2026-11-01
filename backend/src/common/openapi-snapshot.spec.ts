import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * OpenAPI 快照守卫。
 *
 * `docs/openapi.json` 由运行中的服务导出（GET /api/docs-json），提交到仓库供
 * 外部集成方与文档站使用。这里做**结构级**校验，防止有人提交了空文档或坏 JSON：
 * 版本、路径下限、关键路径、安全方案四项。
 *
 * 不比对具体内容——接口增删是正常的，逐字比对会让每次改动都要改快照。
 */
describe('OpenAPI 快照', () => {
  const snapshotPath = join(__dirname, '..', '..', '..', 'docs', 'openapi.json');
  const raw = readFileSync(snapshotPath, 'utf8');
  const doc = JSON.parse(raw) as {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, unknown>;
    components?: { securitySchemes?: Record<string, unknown> };
  };

  it('是合法的 OpenAPI 3 文档', () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toContain('星云盘');
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('路径数量在合理区间（防止空文档或误覆盖）', () => {
    const count = Object.keys(doc.paths).length;
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(500);
  });

  it('覆盖关键业务路径', () => {
    const paths = Object.keys(doc.paths);
    for (const required of ['/api/auth/login', '/api/files', '/api/shares', '/api/quota']) {
      expect(paths).toContain(required);
    }
  });

  it('声明了两种认证方案', () => {
    const schemes = doc.components?.securitySchemes ?? {};
    expect(Object.keys(schemes)).toEqual(expect.arrayContaining(['access_token', 'api-key']));
  });
});
