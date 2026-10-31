<template>
  <div>
    <div class="page-header page-header--row">
      <div>
        <h1>仪表盘</h1>
        <p>文件分发概览</p>
      </div>
      <t-button theme="primary" @click="goToUpload">上传文件</t-button>
    </div>

    <!-- 首屏骨架：与真实卡片同尺寸占位，避免数据到达时整块跳动（CLS） -->
    <div v-if="loading" class="stats-grid" aria-busy="true" aria-label="正在加载统计数据">
      <div v-for="n in 5" :key="n" class="stat-card">
        <div class="skeleton skeleton-line skeleton-line--label"></div>
        <div class="skeleton skeleton-line skeleton-line--value"></div>
      </div>
    </div>

    <div v-else class="stats-grid">
      <div v-for="card in kpiCards" :key="card.label" class="stat-card">
        <div class="stat-head">
          <span class="stat-label">{{ card.label }}</span>
          <span class="stat-icon" aria-hidden="true" v-html="card.icon"></span>
        </div>
        <div class="stat-value" :class="{ 'stat-value--text': card.text }">{{ card.value }}</div>
        <div class="stat-foot">{{ card.hint }}</div>
      </div>
    </div>

    <!-- 上传趋势：shadcn 的「带区间切换的图表卡」结构 -->
    <div class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>上传趋势</h3>
          <p>最近 {{ trendDays }} 天每日上传数量</p>
        </div>
        <div class="segmented" role="group" aria-label="趋势时间范围">
          <button
            v-for="option in trendOptions"
            :key="option"
            type="button"
            class="segmented-item"
            :class="{ active: trendDays === option }"
            :aria-pressed="trendDays === option"
            @click="setTrendDays(option)"
          >
            {{ option }} 天
          </button>
        </div>
      </div>
      <div v-if="trendLoading" class="chart-skeleton" aria-busy="true" aria-label="正在加载趋势">
        <div class="skeleton skeleton-line" style="width: 100%; height: 180px;"></div>
      </div>
      <div v-else ref="trendChartRef" class="trend-chart" role="img" :aria-label="trendSummary"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h3>最近上传</h3>
          <p>最新 5 个文件的处理状态</p>
        </div>
        <t-button variant="text" size="small" @click="goToUpload">查看全部</t-button>
      </div>

      <div v-if="loadError" class="empty-state">
        <div class="empty-icon">!</div>
        <p>{{ loadError }}</p>
        <span class="empty-hint">数据加载失败，请检查网络后重试</span>
        <t-button size="small" variant="outline" style="margin-top: 12px;" @click="loadDashboardData">重试</t-button>
      </div>
      <div v-else-if="recentFiles.length === 0" class="empty-state">
        <div class="empty-icon" aria-hidden="true">⊟</div>
        <p>还没有上传过文件</p>
        <span class="empty-hint">上传后，最近的文件会显示在这里，并可用于生成分享链接</span>
        <t-button theme="primary" class="empty-action" @click="goToUpload">上传第一个文件</t-button>
      </div>
      <div v-else class="recent-list">
        <div v-for="file in recentFiles" :key="file.id" class="recent-row">
          <div class="file-icon" :class="getFileIcon(file.mimeType)">
            <FileTypeIcon :mimeType="file.mimeType" :fileName="file.originalName" :size="18" />
          </div>
          <div class="file-info">
            <div class="file-name">{{ file.originalName }}</div>
            <div class="file-meta">
              {{ formatSize(file.size) }} &middot; {{ formatDate(file.createdAt) }}
            </div>
          </div>
          <t-tag :theme="file.accessType === 'public' ? 'success' : 'warning'" variant="light">
            {{ file.accessType === 'public' ? '公开' : '私有' }}
          </t-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { api } from '../../stores/auth';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { useRouter } from 'vue-router';
import { useCountUp } from '../../composables/useCountUp';
import { formatSize, formatDate } from '@/utils/format';
import FileTypeIcon from '@/components/FileTypeIcon.vue';
// echarts 体积较大（~195KB gzip）且只有仪表盘需要：改为进入图表渲染时动态加载，
// 保持项目「非图表页不为 echarts 付体积」的既有约束（见 utils/echarts.ts 的 PERF 注释）。
type EChartsLib = typeof import('@/utils/echarts');
type EChartsTheme = typeof import('@/utils/echarts-theme');
let echartsLib: EChartsLib | null = null;
let chartTheme: EChartsTheme | null = null;

async function ensureChartLibs(): Promise<void> {
  if (echartsLib && chartTheme) return;
  const [lib, theme] = await Promise.all([
    import('@/utils/echarts'),
    import('@/utils/echarts-theme'),
  ]);
  echartsLib = lib;
  chartTheme = theme;
}
import type { UserRole } from '../../types/user';
import type { FileItem } from '../../types/file';

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const router = useRouter();

const stats = shallowRef({
  fileCount: 0,
  totalSize: 0,
  totalAccessCount: 0,
  todayUploadCount: 0,
});
const recentFiles = shallowRef<FileItem[]>([]);
const loading = ref(true);

const roleText = computed(() => {
  const map: Record<UserRole, string> = { super_admin: '超级管理员', admin: '管理员', user: '普通用户' };
  return map[user.value?.role ?? 'user'] || '普通用户';
});

// new Date() 非响应式，直接在 computed 中使用时仅随 recentFiles 变化重算，跨午夜不会更新。
// 改为依赖响应式日期 ref，并由定时器在跨天后刷新。
const todayStr = ref(new Date().toDateString());
let dayRefreshTimer: ReturnType<typeof setInterval> | null = null;

/** R7：今日上传使用后端 stats 聚合的准确计数（客户端本地日零点口径），
 * 不再从最近 5 条列表估算；stats 缺失字段时回退到最近列表估算避免显示 0 误导 */
const todayUploads = computed(() => {
  const todayCount = stats.value.todayUploadCount;
  if (typeof todayCount === 'number') return todayCount;
  return recentFiles.value.filter(f => new Date(f.createdAt).toDateString() === todayStr.value).length;
});

const fileCountDisplay = useCountUp(computed(() => Number(stats.value.fileCount) || 0));
const totalSizeDisplay = useCountUp(computed(() => Number(stats.value.totalSize) || 0));
const accessCountDisplay = useCountUp(computed(() => Number(stats.value.totalAccessCount) || 0));
const todayUploadsDisplay = useCountUp(computed(() => Number(todayUploads.value) || 0));

/** KPI 卡：标签 / 数值 / 一句上下文说明（shadcn SectionCards 的信息结构）。 */
const kpiCards = computed(() => [
  {
    label: '我的文件',
    icon: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A1.5 1.5 0 013.5 4H8l2 2h6.5A1.5 1.5 0 0118 7.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 15.5v-10z"/></svg>',
    value: String(Math.round(fileCountDisplay.value)),
    hint: `共 ${Math.round(fileCountDisplay.value)} 个文件`,
  },
  {
    label: '总存储',
    icon: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="10" cy="5" rx="7" ry="3"/><path d="M3 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M3 10c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
    value: formatSize(Math.round(totalSizeDisplay.value)),
    hint: fileCountDisplay.value > 0
      ? `平均每文件 ${formatSize(Math.round(totalSizeDisplay.value / Math.max(1, fileCountDisplay.value)))}`
      : '尚未占用空间',
  },
  {
    label: '今日上传',
    icon: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13V3"/><path d="M6 7l4-4 4 4"/><path d="M3 16h14"/></svg>',
    value: String(Math.round(todayUploadsDisplay.value)),
    hint: `今日新增 ${Math.round(todayUploadsDisplay.value)} 个`,
  },
  {
    label: '总访问次数',
    icon: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/><circle cx="10" cy="10" r="2.5"/></svg>',
    value: String(Math.round(accessCountDisplay.value)),
    hint: '累计下载与预览',
  },
  {
    label: '账户类型',
    icon: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3.5"/><path d="M3 18v-1a5 5 0 015-5h4a5 5 0 015 5v1"/></svg>',
    value: roleText.value,
    hint: '按角色分配权限',
    text: true,
  },
]);

/** 空状态与头部动作的主出口：直接去文件页（上传入口在那里），而不是让用户自己找。 */
function goToUpload() {
  void router.push('/files');
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'default';
}

const loadError = ref<string | null>(null);
let loadSeq = 0;

// ---------------------------------------------------------------------------
// 上传趋势（7 / 30 天）
// ---------------------------------------------------------------------------
interface TrendPoint { date: string; count: number; bytes: number }

const trendOptions = [7, 30] as const;
const trendDays = ref<7 | 30>(7);
const trendLoading = ref(true);
const trend = shallowRef<TrendPoint[]>([]);
const trendChartRef = ref<HTMLElement | null>(null);
let trendChart: ReturnType<EChartsLib['init']> | null = null;

/** 无图表环境（屏幕阅读器/JS 禁用降级）下的文字替代 */
const trendSummary = computed(() => {
  const total = trend.value.reduce((sum, item) => sum + item.count, 0);
  return `最近 ${trendDays.value} 天共上传 ${total} 个文件`;
});

async function loadTrend(days: number) {
  trendLoading.value = true;
  try {
    const response = await api.get('/users/me/stats/trend', { params: { days } });
    trend.value = (response.data.data?.days ?? []) as TrendPoint[];
  } catch {
    // 趋势失败只影响图表，不应把整页打成错误态
    trend.value = [];
  } finally {
    trendLoading.value = false;
  }
  await nextTick();
  await renderTrendChart();
}

async function renderTrendChart() {
  if (!trendChartRef.value || trend.value.length === 0) return;
  await ensureChartLibs();
  if (!echartsLib || !chartTheme) return;
  chartTheme.ensureCyberTheme();
  if (!trendChart) {
    trendChart = echartsLib.init(trendChartRef.value, 'cyber');
  }
  trendChart.setOption({
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...chartTheme!.tooltipBase,
      trigger: 'axis',
      formatter: (params: Array<{ name: string; value: number }>) => {
        const point = params?.[0];
        if (!point) return '';
        return `${point.name}<br/>上传 ${point.value} 个`;
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: trend.value.map((item) => item.date.slice(5)),
      axisLine: { lineStyle: { color: 'var(--border-default)' } },
      axisTick: { show: false },
      axisLabel: { color: 'var(--text-tertiary)', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'var(--border-default)', type: 'dashed' } },
      axisLabel: { color: 'var(--text-tertiary)', fontSize: 11 },
    },
    series: [
      {
        // 上传数量是离散整数：用柱状表达真实值，避免平滑曲线在 0/1 之间
        // 插值出并不存在的「波峰/波谷」。
        type: 'bar',
        data: trend.value.map((item) => item.count),
        barMaxWidth: 28,
        itemStyle: {
          color: chartTheme!.CHART_COLORS.primary,
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  }, true);
}

function setTrendDays(days: 7 | 30) {
  if (trendDays.value === days) return;
  trendDays.value = days;
  void loadTrend(days);
}

async function loadDashboardData() {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = null;
  // R7：以客户端本地今日零点为统计口径传给后端，避免服务器/用户时区不一致
  const localDayStart = new Date();
  localDayStart.setHours(0, 0, 0, 0);
  const [statsResult, filesResult] = await Promise.allSettled([
    api.get('/users/me/stats', { params: { todayStart: localDayStart.toISOString() } }),
    api.get('/files?limit=5'),
  ]);
  // 防止并发重试时旧请求覆盖新状态
  if (seq !== loadSeq) return;
  if (statsResult.status === 'fulfilled') {
    stats.value = statsResult.value.data.data;
  } else {
    loadError.value = '统计信息加载失败';
  }
  if (filesResult.status === 'fulfilled') {
    recentFiles.value = filesResult.value.data.data.files;
  } else if (!loadError.value) {
    loadError.value = '最近文件加载失败';
  }
  loading.value = false;
}

function handleResize() {
  trendChart?.resize();
}

watch(() => stats.value, () => {
  // 数值滚动由 useCountUp 处理，这里只在趋势数据变化后重绘
});

onMounted(async () => {
  await loadDashboardData();
  await loadTrend(trendDays.value);
  window.addEventListener('resize', handleResize);
  // 每分钟检查是否跨天，仅在日期真正变化时更新，避免多余渲染
  dayRefreshTimer = setInterval(() => {
    const d = new Date().toDateString();
    if (d !== todayStr.value) {
      todayStr.value = d;
      void loadDashboardData();
      void loadTrend(trendDays.value);
    }
  }, 60_000);
});

onUnmounted(() => {
  if (dayRefreshTimer) {
    clearInterval(dayRefreshTimer);
    dayRefreshTimer = null;
  }
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  trendChart = null;
});
</script>

<style scoped>
/* 卡片头部：标题 + 说明 + 右侧动作（shadcn CardHeader 的信息结构） */
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.card-head-text h3 {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 2px;
}
.card-head-text p {
  font-size: 13px;
  color: var(--text-tertiary);
}

/* 分段控件：shadcn 的 Tabs / ToggleGroup 外观 */
.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--muted);
  border-radius: var(--radius-md);
}
.segmented-item {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 10px;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-expo),
              color var(--duration-fast) var(--ease-out-expo);
}
.segmented-item:hover { color: var(--text-primary); }
.segmented-item.active {
  background: var(--card);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.trend-chart { width: 100%; height: 200px; }
.chart-skeleton { height: 200px; display: flex; align-items: center; }

/* KPI 卡 */
.stats-grid { align-items: stretch; }
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.stat-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.stat-icon { color: var(--text-tertiary); display: inline-flex; }

.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  line-height: 1.2;
}
.stat-value--text {
  font-size: 20px;
  letter-spacing: 0;
}
.stat-foot {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 最近上传列表：行式，无多余边框 */
.recent-list { display: flex; flex-direction: column; }
.recent-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 2px;
  border-bottom: 1px solid var(--border-default);
}
.recent-row:last-child { border-bottom: none; }
.recent-row .file-info { min-width: 0; flex: 1; }
.recent-row .file-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-row .file-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }

.empty-state { text-align: center; padding: 40px 0; }
.empty-icon { font-size: 40px; color: var(--text-tertiary); margin-bottom: 12px; }
.empty-state p { color: var(--text-secondary); font-size: 15px; margin-bottom: 4px; }
.empty-hint { color: var(--text-tertiary); font-size: 13px; display: block; }
.empty-action { margin-top: 16px; }

/* 最近上传骨架 */
.recent-skeleton { display: flex; flex-direction: column; gap: 14px; }
.recent-skeleton-row { display: flex; align-items: center; gap: 12px; }
.recent-skeleton-text { flex: 1; display: flex; flex-direction: column; gap: 7px; }
</style>
