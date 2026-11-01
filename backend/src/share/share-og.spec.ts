import {
  SHARE_META_BEGIN,
  SHARE_META_END,
  escapeHtmlAttribute,
  injectShareMeta,
  type ShareOgMeta,
} from './share-og';

const BASE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>星云盘</title>
    ${'<!--SHARE_META:BEGIN-->'}
    <meta property="og:title" content="默认标题" />
    ${'<!--SHARE_META:END-->'}
  </head>
  <body><div id="app"></div></body>
</html>`;

const META: ShareOgMeta = {
  title: '品牌规范.pdf',
  description: '4.6 MB · PDF · 星云盘',
  url: 'https://pan.example.com/s/abc123',
  siteName: '星云盘',
};

describe('分享页 OG 注入', () => {
  it('替换 title 并写入 og 系列标签', () => {
    const html = injectShareMeta(BASE_HTML, META);
    expect(html).toContain('<title>品牌规范.pdf</title>');
    expect(html).toContain('property="og:title" content="品牌规范.pdf"');
    expect(html).toContain('property="og:description" content="4.6 MB · PDF · 星云盘"');
    expect(html).toContain('property="og:url" content="https://pan.example.com/s/abc123"');
    expect(html).toContain('property="og:site_name" content="星云盘"');
    // 没有图片时用 summary 卡片
    expect(html).toContain('name="twitter:card" content="summary"');
    // 区域标记与默认标签都被替换掉，不留重复 og
    expect(html).not.toContain(SHARE_META_BEGIN);
    expect(html).not.toContain(SHARE_META_END);
    expect(html).not.toContain('content="默认标题"');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });

  it('有图片时用大图卡片并输出 og:image', () => {
    const html = injectShareMeta(BASE_HTML, { ...META, image: 'https://pan.example.com/og.png' });
    expect(html).toContain('property="og:image" content="https://pan.example.com/og.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('noindex 时输出 robots，密码分享不被收录', () => {
    const html = injectShareMeta(BASE_HTML, { ...META, noindex: true });
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it('文件名为恶意输入时属性被转义，不产生新属性', () => {
    const evil = 'x"><script>alert(1)</script><a b="';
    const html = injectShareMeta(BASE_HTML, { ...META, title: evil });
    // 尖括号/引号必须被实体化
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
    // title 标签里也不能出现裸标签
    expect(html).not.toContain('<title>x">');
  });

  it('只有单标记（无区域）时替换该标记', () => {
    const withMarker = '<html><head><title>旧</title><!--SHARE_META--></head><body></body></html>';
    const html = injectShareMeta(withMarker, META);
    expect(html).not.toContain('<!--SHARE_META-->');
    expect(html).toContain('property="og:title" content="品牌规范.pdf"');
  });

  it('没有占位标记时插入到 </head> 之前', () => {
    const plain = '<html><head><title>旧标题</title></head><body></body></html>';
    const html = injectShareMeta(plain, META);
    expect(html).toContain('<title>品牌规范.pdf</title>');
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('</head>')).toBeLessThan(html.indexOf('<body>'));
  });

  it('缺少 </head> 的畸形 HTML 原样返回，不抛错', () => {
    const broken = '<html><head><title>x</title>';
    expect(() => injectShareMeta(broken, META)).not.toThrow();
    expect(injectShareMeta(broken, META)).toContain('<title>品牌规范.pdf</title>');
  });

  it('转义函数覆盖五个关键字符', () => {
    expect(escapeHtmlAttribute(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
