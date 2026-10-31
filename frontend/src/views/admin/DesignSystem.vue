<template>
  <div class="ds-page">
    <div class="page-header">
      <h1>设计规范</h1>
      <p>设计令牌、控件状态与使用边界的唯一参照 · 切换主题可实时预览</p>
    </div>

    <!-- 1. 颜色令牌 -->
    <section class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>颜色令牌</h3>
          <p>对比度为实时计算值（相对 <code>--background</code>），标红低于 4.5:1；<code>--text-disabled</code> 属 WCAG 豁免项</p>
        </div>
      </div>

      <div v-for="group in colorGroups" :key="group.title" class="token-group">
        <h4 class="token-group-title">{{ group.title }}</h4>
        <div class="swatch-grid">
          <div v-for="token in group.items" :key="token.name" class="swatch">
            <span class="swatch-chip" :style="{ background: `var(${token.name})` }"></span>
            <div class="swatch-meta">
              <code class="swatch-name">{{ token.name }}</code>
              <span class="swatch-value">{{ token.value }}</span>
              <span
                v-if="token.contrast !== null"
                class="swatch-contrast"
                :class="{ fail: token.contrast < (token.threshold ?? 4.5) }"
              >
                {{ token.contrast.toFixed(2) }}:1
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 2. 字体与圆角 -->
    <div class="ds-split">
      <section class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>字体阶梯</h3>
            <p>系统字体栈，不引入 Web 字体（避免 FOUT 与额外请求）</p>
          </div>
        </div>
        <div class="type-scale">
          <div v-for="row in typeScale" :key="row.label" class="type-row">
            <span class="type-label">{{ row.label }}</span>
            <span :style="{ fontSize: row.size, fontWeight: row.weight, letterSpacing: row.tracking || 'normal' }">
              {{ row.sample }}
            </span>
            <code class="type-spec">{{ row.size }} / {{ row.weight }}</code>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>圆角与间距</h3>
            <p>shadcn 的 0.625rem 基准</p>
          </div>
        </div>
        <div class="radius-row">
          <div v-for="r in radii" :key="r.name" class="radius-item">
            <span class="radius-box" :style="{ borderRadius: `var(${r.name})` }"></span>
            <code>{{ r.name }}</code>
            <span class="radius-px">{{ r.px }}</span>
          </div>
        </div>
        <div class="space-row">
          <div v-for="s in spaces" :key="s.name" class="space-item">
            <span class="space-box" :style="{ width: `var(${s.name})` }"></span>
            <code>{{ s.name }}</code>
          </div>
        </div>
      </section>
    </div>

    <!-- 3. 按钮 -->
    <section class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>按钮</h3>
          <p>每个视图只应有一个主操作；破坏性操作使用 danger 并与其他操作分开</p>
        </div>
      </div>
      <div class="state-matrix">
        <div v-for="row in buttonRows" :key="row.title" class="matrix-row">
          <span class="matrix-label">{{ row.title }}</span>
          <div class="matrix-cells">
            <t-button
              v-for="variant in row.variants"
              :key="variant.key"
              :theme="row.theme"
              :variant="variant.variant"
              :disabled="row.disabled"
            >
              {{ variant.label }}
            </t-button>
          </div>
        </div>
      </div>
      <div class="state-matrix">
        <div class="matrix-row">
          <span class="matrix-label">尺寸</span>
          <div class="matrix-cells">
            <t-button size="small">小按钮</t-button>
            <t-button>默认</t-button>
            <t-button size="large" theme="primary">大按钮</t-button>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. 输入与反馈 -->
    <div class="ds-split">
      <section class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>输入框</h3>
            <p>focus 用 ring 扩散；错误态贴近字段而不是只在顶部提示</p>
          </div>
        </div>
        <div class="field-stack">
          <label class="field">
            <span class="field-label">默认</span>
            <t-input placeholder="请输入内容..." />
          </label>
          <label class="field">
            <span class="field-label">禁用</span>
            <t-input placeholder="不可编辑" disabled />
          </label>
          <label class="field">
            <span class="field-label">错误</span>
            <t-input class="is-error" placeholder="格式不正确" value="abc" />
            <span class="field-error">请输入有效的邮箱地址</span>
          </label>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>标签与状态</h3>
            <p>颜色不单独承载语义，必须配合文案</p>
          </div>
        </div>
        <div class="tag-row">
          <t-tag theme="primary" variant="light">主色</t-tag>
          <t-tag theme="success" variant="light">成功</t-tag>
          <t-tag theme="warning" variant="light">警告</t-tag>
          <t-tag theme="danger" variant="light">危险</t-tag>
          <t-tag variant="outline">描边</t-tag>
        </div>

        <h4 class="token-group-title" style="margin-top: 20px;">分段控件</h4>
        <div class="segmented" role="group" aria-label="示例分段控件">
          <button
            v-for="option in ['7 天', '30 天', '90 天']"
            :key="option"
            type="button"
            class="segmented-item"
            :class="{ active: segmentValue === option }"
            :aria-pressed="segmentValue === option"
            @click="segmentValue = option"
          >
            {{ option }}
          </button>
        </div>

        <h4 class="token-group-title" style="margin-top: 20px;">加载占位</h4>
        <div class="skeleton skeleton-line skeleton-line--name"></div>
        <div class="skeleton skeleton-line skeleton-line--meta" style="margin-top: 8px;"></div>
      </section>
    </div>

    <!-- 5. 空状态 -->
    <section class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>空状态</h3>
          <p>空状态要给出口，不能只写一句「暂无数据」</p>
        </div>
      </div>
      <div class="empty-demo">
        <div class="empty-icon" aria-hidden="true">⊟</div>
        <p>还没有上传过文件</p>
        <span class="empty-hint">上传后，最近的文件会显示在这里，并可用于生成分享链接</span>
        <t-button theme="primary" style="margin-top: 16px;">上传第一个文件</t-button>
      </div>
    </section>

    <!-- 6. 正误对照 -->
    <section class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>正误对照</h3>
          <p>这些是最容易在新增页面时写错的几条</p>
        </div>
      </div>
      <div class="dodont-grid">
        <div v-for="pair in doDont" :key="pair.title" class="dodont">
          <h4 class="dodont-title">{{ pair.title }}</h4>
          <div class="dodont-row dodont-do">
            <span class="badge-ok">✓</span>
            <code>{{ pair.do }}</code>
          </div>
          <div class="dodont-row dodont-dont">
            <span class="badge-no">✕</span>
            <code>{{ pair.dont }}</code>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const segmentValue = ref('7 天');

/**
 * 解析 CSS 变量为具体颜色。
 * 不能直接读 getPropertyValue：大量令牌是 color-mix() 表达式，
 * 需要在真实元素上让浏览器解析成 rgb。
 */
function resolveVar(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function parseRgb(color: string): [number, number, number] | null {
  // color-mix() 的解析结果在 Chromium 上是 `color(srgb 0.1 0.2 0.3)`，
  // 普通颜色是 `rgb(r, g, b)`。两种都要能算对比度。
  const srgb = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  }
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1]!.split(',').map((n) => Number.parseFloat(n.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return null;
  const lf = relativeLuminance(fg);
  const lb = relativeLuminance(bg);
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
}

// 主题切换后需要重新解析（令牌在暗色下有不同取值）
const themeTick = ref(0);
let observer: MutationObserver | null = null;

interface Swatch { name: string; value: string; contrast: number | null; threshold?: number }

function buildSwatches(names: string[], baseVar: string): Swatch[] {
  // 读取 themeTick 以建立依赖，主题变化时重新计算
  void themeTick.value;
  const base = resolveVar(baseVar);
  const isForeground = (name: string) =>
    /^--(text-|primary|destructive|ring|seed-fg|seed-primary|seed-accent)/.test(name);
  return names.map((name) => {
    const value = resolveVar(name);
    const ratio = isForeground(name) ? contrastRatio(value, base) : null;
    // ring 是非文本指示器：WCAG 1.4.11 只要求 3:1
    const threshold = name === '--ring' ? 3 : 4.5;
    return { name, value, contrast: ratio, threshold };
  });
}

const background = computed(() => {
  void themeTick.value;
  return resolveVar('--background');
});

const colorGroups = computed(() => {
  void themeTick.value;
  return [
    {
      title: '种子令牌（主题切换只改这一层）',
      items: buildSwatches(
        ['--seed-bg', '--seed-fg', '--seed-primary', '--seed-accent', '--seed-surface'],
        '--seed-bg',
      ),
    },
    {
      title: '语义令牌（组件只允许用这一层）',
      items: buildSwatches(
        ['--background', '--card', '--muted', '--primary', '--accent', '--destructive', '--border', '--input', '--ring'],
        '--background',
      ),
    },
    {
      title: '文字令牌',
      items: buildSwatches(
        ['--text-primary', '--text-secondary', '--text-tertiary', '--text-disabled', '--text-accent'],
        '--background',
      ),
    },
  ];
});

const typeScale = [
  { label: '页面标题', size: '22px', weight: 600, sample: '仪表盘', tracking: '-0.02em' },
  { label: '卡片标题', size: '15px', weight: 600, sample: '最近上传' },
  { label: '指标数值', size: '28px', weight: 600, sample: '242.32 MB', tracking: '-0.02em' },
  { label: '正文', size: '14px', weight: 400, sample: '上传后，最近的文件会显示在这里' },
  { label: '次要说明', size: '13px', weight: 400, sample: '支持图片、PDF、ZIP 等格式' },
  { label: '标签/注释', size: '12px', weight: 500, sample: '公开分享链接' },
];

const radii = [
  { name: '--radius-sm', px: '6px' },
  { name: '--radius-md', px: '8px' },
  { name: '--radius-lg', px: '10px' },
  { name: '--radius-xl', px: '14px' },
];

const spaces = [
  { name: '--space-1' }, { name: '--space-2' }, { name: '--space-3' },
  { name: '--space-4' }, { name: '--space-6' }, { name: '--space-8' },
];

const buttonRows = [
  {
    title: '主按钮',
    theme: 'primary' as const,
    variants: [{ key: 'base', variant: 'base' as const, label: '保存' }],
  },
  {
    title: '次要按钮',
    theme: 'default' as const,
    variants: [
      { key: 'outline', variant: 'outline' as const, label: '取消' },
      { key: 'text', variant: 'text' as const, label: '了解更多' },
    ],
  },
  {
    title: '破坏性操作',
    theme: 'danger' as const,
    variants: [{ key: 'danger', variant: 'base' as const, label: '删除' }],
  },
  {
    title: '禁用态',
    theme: 'primary' as const,
    disabled: true,
    variants: [{ key: 'disabled', variant: 'base' as const, label: '不可用' }],
  },
];

const doDont = [
  { title: '颜色', do: 'var(--primary) / var(--text-secondary)', dont: "#1E40AF / color: gray" },
  { title: '间距', do: 'gap: var(--space-3)', dont: 'margin-left: 13px' },
  { title: '空状态', do: '说明 + 下一步操作', dont: '只写「暂无数据」' },
  { title: '破坏性操作', do: 'danger 语义 + 二次确认', dont: '与主操作并排同权重' },
];

onMounted(() => {
  observer = new MutationObserver(() => { themeTick.value += 1; });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});

// 供模板调试用（避免未使用变量告警）
void background;
</script>

<style scoped>
.ds-page { display: flex; flex-direction: column; gap: 0; }

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.card-head-text h3 { font-family: var(--font-display); font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.card-head-text p { font-size: 13px; color: var(--text-tertiary); }
.card-head-text code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--muted);
}

.ds-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 1024px) { .ds-split { grid-template-columns: 1fr; } }

/* 色板 */
.token-group { margin-bottom: 20px; }
.token-group:last-child { margin-bottom: 0; }
.token-group-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.swatch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.swatch {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.swatch-chip {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
}
.swatch-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.swatch-name { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
.swatch-value { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
.swatch-contrast { font-size: 10px; color: var(--color-success); }
.swatch-contrast.fail { color: var(--color-danger); }

/* 字体 */
.type-scale { display: flex; flex-direction: column; gap: 12px; }
.type-row { display: flex; align-items: baseline; gap: 12px; }
.type-label { width: 72px; flex: none; font-size: 11px; color: var(--text-tertiary); }
.type-spec { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }

/* 圆角与间距 */
.radius-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.radius-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.radius-box {
  width: 54px;
  height: 54px;
  background: var(--accent);
  border: 1px solid var(--border-default);
}
.radius-item code { font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
.radius-px { font-size: 10px; color: var(--text-tertiary); }

.space-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.space-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.space-box { height: 14px; background: var(--primary); border-radius: 2px; }
.space-item code { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }

/* 状态矩阵 */
.state-matrix { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.matrix-row { display: flex; align-items: center; gap: 16px; }
.matrix-label { width: 84px; flex: none; font-size: 12px; color: var(--text-tertiary); }
.matrix-cells { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* 表单 */
.field-stack { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
.field-error { font-size: 12px; color: var(--color-danger); }
/* 错误态演示：边框与 focus 环都要转成危险色，否则「错误」标签是误导 */
.field .is-error :deep(.t-input),
.field :deep(.is-error .t-input) {
  border-color: var(--destructive);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--destructive) 18%, transparent);
}

.tag-row { display: flex; gap: 8px; flex-wrap: wrap; }

.segmented { display: inline-flex; gap: 2px; padding: 2px; background: var(--muted); border-radius: var(--radius-md); }
.segmented-item {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
}
.segmented-item.active { background: var(--card); color: var(--text-primary); box-shadow: var(--shadow-sm); }

/* 空状态 */
.empty-demo { text-align: center; padding: 28px 0; }
.empty-icon { font-size: 40px; color: var(--text-tertiary); margin-bottom: 12px; }
.empty-demo p { color: var(--text-secondary); font-size: 15px; margin-bottom: 4px; }
.empty-hint { color: var(--text-tertiary); font-size: 13px; display: block; }

/* 正误对照 */
.dodont-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.dodont { border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; }
.dodont-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
.dodont-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
.dodont-row code { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); word-break: break-all; }
.badge-ok { color: var(--color-success); font-weight: 700; }
.badge-no { color: var(--color-danger); font-weight: 700; }
.dodont-dont code { color: var(--text-tertiary); text-decoration: line-through; }
</style>
