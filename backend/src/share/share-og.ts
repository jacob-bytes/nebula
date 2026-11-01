/**
 * 分享页 Open Graph 元信息注入。
 *
 * 为什么要服务端注入：`/s/:token` 是 SPA 路由，爬虫（Telegram / 微信 / Twitter）
 * 不执行 JS，只会读到 index.html 里的通用标题——分享链接发出去是一片白卡片。
 * 这里在 HTML 出口处把分享的真实标题/描述/图片替换进去。
 *
 * 设计约束：
 * - **纯函数**：不读文件、不发请求，便于单测覆盖转义与边界；
 * - **必须转义**：文件名是用户可控输入，直接拼进 attribute 会造成属性逃逸（XSS）；
 * - 找不到占位标记时退回“插入到 </head> 前”，兼容未改造的 index.html。
 */

export interface ShareOgMeta {
  /** 分享内容标题（文件名或文件夹名） */
  title: string;
  /** 一句话描述：类型 · 大小 · 站点名 */
  description: string;
  /** 规范 URL（含 token） */
  url: string;
  /** 站点名 */
  siteName: string;
  /** 预览图绝对 URL；缺省时用 summary 卡片 */
  image?: string;
  /** 密码保护或已失效时置 true：不要让搜索引擎收录 */
  noindex?: boolean;
}

/** HTML 属性值转义：& < > " ' 全部实体化，避免属性逃逸 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 占位标记：index.html 中用它控制注入位置 */
export const SHARE_META_MARKER = '<!--SHARE_META-->';
/** 区域标记：默认标签包在这两个标记之间，注入时整段替换（避免出现重复 og 标签） */
export const SHARE_META_BEGIN = '<!--SHARE_META:BEGIN-->';
export const SHARE_META_END = '<!--SHARE_META:END-->';

function buildMetaTags(meta: ShareOgMeta): string {
  const esc = escapeHtmlAttribute;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(meta.siteName)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta name="description" content="${esc(meta.description)}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${esc(meta.image)}" />`);
    tags.push('<meta name="twitter:card" content="summary_large_image" />');
  } else {
    tags.push('<meta name="twitter:card" content="summary" />');
  }
  tags.push(`<meta name="twitter:title" content="${esc(meta.title)}" />`);
  tags.push(`<meta name="twitter:description" content="${esc(meta.description)}" />`);
  if (meta.noindex) {
    tags.push('<meta name="robots" content="noindex, nofollow" />');
  }
  return tags.join('\n    ');
}

/**
 * 把分享元信息注入到 index.html。
 *
 * 1. 替换 `<title>`（爬虫与浏览器标签页都用它）；
 * 2. 有占位标记则替换标记，否则插入到 `</head>` 之前；
 * 3. 输入不含 `</head>` 时原样返回——宁可没有 OG，也不要产出坏 HTML。
 */
export function injectShareMeta(html: string, meta: ShareOgMeta): string {
  const esc = escapeHtmlAttribute;
  let result = html;

  // 标题：只替换第一个 <title>…</title>，避免误伤正文里的字符串
  if (/<title>[^<]*<\/title>/i.test(result)) {
    result = result.replace(/<title>[^<]*<\/title>/i, `<title>${esc(meta.title)}</title>`);
  }

  const tags = buildMetaTags(meta);

  // 1) 优先整段替换默认区域：同时保留默认标签会让爬虫看到两份 og，取值规则因实现而异
  const begin = result.indexOf(SHARE_META_BEGIN);
  const end = result.indexOf(SHARE_META_END);
  if (begin !== -1 && end > begin) {
    return result.slice(0, begin) + tags + result.slice(end + SHARE_META_END.length);
  }

  // 2) 单标记替换
  if (result.includes(SHARE_META_MARKER)) {
    return result.replace(SHARE_META_MARKER, tags);
  }

  const headEnd = result.indexOf('</head>');
  if (headEnd === -1) {
    return result;
  }
  return `${result.slice(0, headEnd)}    ${tags}\n  ${result.slice(headEnd)}`;
}
