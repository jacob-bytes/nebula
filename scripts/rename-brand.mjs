#!/usr/bin/env node
/**
 * 品牌改名器。
 *
 * 用法：
 *   node scripts/rename-brand.mjs                    # 按 brand.json 当前值重写生成的常量文件
 *   node scripts/rename-brand.mjs <slug> <中文名> [英文名]
 *
 * 行为：
 *   1. 读取 brand.json 里的 previous（上一次的品牌标识）；
 *   2. 用 previous → 新值 做全仓受控替换（只处理 git 跟踪的文本文件）；
 *   3. 重新生成 backend/src/common/brand.ts 与 frontend/src/brand.ts；
 *   4. 把新值写回 brand.json（slug / nameZh / nameEn），previous 更新为当前值。
 *
 * 替换规则（大小写敏感，按顺序执行）：
 *   TGTC → 大写下划线前缀（环境变量、systemd 单元）
 *   Tgtc → HTTP 头等首字母大写场景
 *   tgtc → 普通标识（包名、路径、API Key 前缀）
 *   中文名整体替换
 *
 * 设计取舍：不做 Git 历史改写；只改工作区文件，改完由人 review 后提交。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_FILE = resolve(ROOT, 'brand.json');

/** 参与替换的扩展名（只处理文本文件，避免破坏二进制）。 */
const TEXT_EXT = new Set([
  '.ts', '.vue', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css',
  '.sh', '.yml', '.yaml', '.example', '.service', '.rules', '.sudoers', '.conf', '.template', '.env',
]);
/** 永不改写的路径片段。 */
const SKIP_PATHS = [
  'node_modules/', 'dist/', 'coverage/', 'package-lock.json', '.npm-cache/',
  'docs/release-notes/', 'brand.json', 'scripts/rename-brand.mjs',
];

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

function die(message) {
  console.error(`rename-brand: ${message}`);
  process.exit(1);
}

function loadBrand() {
  if (!existsSync(BRAND_FILE)) die(`找不到 ${BRAND_FILE}`);
  return JSON.parse(readFileSync(BRAND_FILE, 'utf8'));
}

function parseArgs(argv) {
  const [slug, nameZh, nameEn] = argv;
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug)) die(`slug 必须匹配 ${SLUG_PATTERN}，收到 "${slug}"`);
  if (!nameZh) die('缺少中文名：node scripts/rename-brand.mjs <slug> <中文名> [英文名]');
  return { slug, nameZh, nameEn: nameEn || slug.charAt(0).toUpperCase() + slug.slice(1) };
}

function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/** 构造替换对，长的先替换，避免 "TGTC" 被 "tgtc" 规则先吃掉。 */
function buildRules(prev, next) {
  const rules = [];
  const add = (from, to) => {
    if (from && from !== to) rules.push([from, to]);
  };
  add(prev.nameZh, next.nameZh);
  add(prev.slug.toUpperCase(), next.slug.toUpperCase());
  add(
    prev.slug.charAt(0).toUpperCase() + prev.slug.slice(1),
    next.slug.charAt(0).toUpperCase() + next.slug.slice(1),
  );
  add(prev.slug, next.slug);
  if (prev.nameEn) add(prev.nameEn, next.nameEn);
  return rules;
}

function rewriteFile(absPath, rules) {
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  if (!TEXT_EXT.has(ext)) return 0;
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return 0;
  }
  let hits = 0;
  for (const [from, to] of rules) {
    if (!text.includes(from)) continue;
    const before = text;
    text = text.split(from).join(to);
    if (text !== before) hits += before.split(from).length - 1;
  }
  if (hits > 0) writeFileSync(absPath, text);
  return hits;
}

const backendBrand = (brand) => `/**
 * 品牌常量（后端唯一事实源，由 scripts/rename-brand.mjs 生成，勿手改）。
 *
 * 凡是会出现在用户视野里的产品标识都应从这里取：
 * 站点标题、API Key 前缀、错误码响应头、SQLite 默认文件名。
 */
/** 品牌信息形状。字段刻意声明为 string（而非字面量类型），
 * 否则 const DEFAULT_SITE_TITLE = BRAND_SITE_TITLE 会被窄化成字面量，
 * 后续把后台配置的任意字符串赋给同一变量时类型不兼容。 */
export interface BrandInfo {
  /** 小写标识：用于 package 名、文件路径、API Key 前缀、systemd 单元名 */
  readonly slug: string;
  /** 中文站点名：页面标题、邮件主题、默认 SITE_TITLE */
  readonly nameZh: string;
  /** 英文名：对外文档与英文界面 */
  readonly nameEn: string;
}

export const BRAND: BrandInfo = {
  slug: '${brand.slug}',
  nameZh: '${brand.nameZh}',
  nameEn: '${brand.nameEn}',
};

export const BRAND_SLUG: string = BRAND.slug;
export const BRAND_SITE_TITLE: string = BRAND.nameZh;
export const BRAND_API_KEY_PREFIX: string = BRAND.slug;
/** 业务错误码响应头：前端排队/退避逻辑依赖该名字，两端必须一致。 */
export const BRAND_ERROR_CODE_HEADER =
  'X-' + BRAND.slug.charAt(0).toUpperCase() + BRAND.slug.slice(1) + '-Error-Code';
`;

const frontendBrand = (brand) => `/**
 * 品牌常量（前端唯一事实源，由 scripts/rename-brand.mjs 生成，勿手改）。
 *
 * 与 backend/src/common/brand.ts 保持同名同值；错误码响应头必须与后端逐字符一致。
 */
export interface BrandInfo {
  readonly slug: string;
  readonly nameZh: string;
  readonly nameEn: string;
}

export const BRAND: BrandInfo = {
  slug: '${brand.slug}',
  nameZh: '${brand.nameZh}',
  nameEn: '${brand.nameEn}',
};

export const BRAND_SITE_TITLE: string = BRAND.nameZh;
export const BRAND_ERROR_CODE_HEADER = 'x-' + BRAND.slug + '-error-code';
`;

function writeGenerated(brand) {
  writeFileSync(resolve(ROOT, 'backend/src/common/brand.ts'), backendBrand(brand));
  writeFileSync(resolve(ROOT, 'frontend/src/brand.ts'), frontendBrand(brand));
}

function main() {
  const brand = loadBrand();
  const next = parseArgs(process.argv.slice(2));
  const prev = brand.previous ?? { slug: brand.slug, nameZh: brand.nameZh, nameEn: brand.nameEn };

  if (!next) {
    // 无参数：只重新生成常量文件，便于品牌值手改后同步。
    writeGenerated(brand);
    console.log(`rename-brand: 已按 brand.json 重新生成 brand.ts（slug=${brand.slug}）`);
    return;
  }

  if (next.slug === prev.slug && next.nameZh === prev.nameZh) {
    writeGenerated(next);
    console.log('rename-brand: 品牌未变化，仅重新生成常量文件');
    return;
  }

  const rules = buildRules(prev, next);
  let changedFiles = 0;
  let totalHits = 0;
  for (const rel of listTrackedFiles()) {
    if (SKIP_PATHS.some((skip) => rel.includes(skip))) continue;
    const hits = rewriteFile(resolve(ROOT, rel), rules);
    if (hits > 0) {
      changedFiles += 1;
      totalHits += hits;
    }
  }

  // previous 必须推进为「本次改名前的品牌」，否则第二次改名仍会去替换早已不存在的旧标识。
  const appliedFrom = { slug: brand.slug, nameZh: brand.nameZh, nameEn: brand.nameEn };
  const updated = { ...brand, slug: next.slug, nameZh: next.nameZh, nameEn: next.nameEn, previous: appliedFrom };
  writeFileSync(BRAND_FILE, `${JSON.stringify(updated, null, 2)}\n`);
  writeGenerated(next);

  console.log(`rename-brand: ${prev.slug}/${prev.nameZh} → ${next.slug}/${next.nameZh}`);
  console.log(`rename-brand: 改写 ${changedFiles} 个文件，共 ${totalHits} 处`);
  console.log('rename-brand: 请执行 npm run typecheck 与构建验证，并检查 git diff。');
}

main();
