<template>
  <div>
    <div class="page-header">
      <h1>管理后台</h1>
      <p>系统运行概览与数据统计</p>
    </div>

    <!-- 6 张指标卡：固定 3 列，避免 auto-fit 产生 5+1 的孤行 -->
    <div class="admin-kpi-grid">
      <div v-for="kpi in kpis" :key="kpi.label" class="stat-card">
        <div class="stat-head">
          <span class="stat-label">{{ kpi.label }}</span>
          <span class="stat-icon" :style="{ color: kpi.tone }" aria-hidden="true" v-html="kpi.icon"></span>
        </div>
        <div class="stat-value">{{ kpi.value }}</div>
        <div class="stat-foot">{{ kpi.hint }}</div>
      </div>
    </div>

    <div class="dashboard-split-grid">
      <div class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>我的文件统计</h3>
            <p>当前登录管理员名下的数据</p>
          </div>
        </div>
        <!-- 指标用分隔线分组，不再卡片套卡片（两层边框叠加会显脏） -->
        <div class="metric-row">
          <div class="metric">
            <span class="metric-label">我的文件</span>
            <span class="metric-value">{{ myFiles.fileCount }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">我的存储</span>
            <span class="metric-value">{{ formatSize(myFiles.totalSize) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">我的访问次数</span>
            <span class="metric-value">{{ myFiles.totalAccessCount }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h3>全站月度访问量</h3>
            <p>近 {{ stats.monthlyAccess.length || 12 }} 个月</p>
          </div>
        </div>

        <div v-if="stats.monthlyAccess.length === 0" class="chart-empty">
          <div class="chart-empty-bars" aria-hidden="true">
            <span v-for="n in 6" :key="n" :style="{ height: `${18 + ((n * 13) % 46)}px` }"></span>
          </div>
          <p>暂无访问数据</p>
          <span class="chart-empty-hint">有用户开始下载或预览后，这里会显示月度趋势</span>
        </div>

        <div v-else class="monthly-chart">
          <div class="chart-bars">
            <div
              v-for="item in stats.monthlyAccess"
              :key="item.month"
              class="chart-bar-wrapper"
              :title="`${item.month}: ${item.count} 次`"
            >
              <div class="chart-bar-label">{{ item.count }}</div>
              <div class="chart-bar" :style="{ height: getBarHeight(item.count) }"></div>
              <div class="chart-bar-month">{{ formatMonth(item.month) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, computed, onMounted, onUnmounted } from 'vue';
import { formatSize } from '@/utils/format';
import { api } from '../../stores/auth';

const stats = shallowRef({
  totalUsers: 0,
  activeUsers: 0,
  bannedUsers: 0,
  totalFiles: 0,
  totalStorage: 0,
  totalAccessCount: 0,
  monthlyAccess: [] as { month: string; count: number }[],
});

const myFiles = shallowRef({
  fileCount: 0,
  totalSize: 0,
  totalAccessCount: 0,
});

const iconUser = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3.5"/><path d="M3 18v-1a5 5 0 015-5h4a5 5 0 015 5v1"/></svg>';
const iconFolder = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A1.5 1.5 0 013.5 4H8l2 2h6.5A1.5 1.5 0 0118 7.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 15.5v-10z"/></svg>';
const iconStorage = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="10" cy="5" rx="7" ry="3"/><path d="M3 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M3 10c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>';
const iconEye = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/><circle cx="10" cy="10" r="2.5"/></svg>';

/** KPI 卡数据：标签 / 数值 / 语义色图标 / 一句上下文说明。 */
const kpis = computed(() => [
  {
    label: '总用户数',
    value: String(stats.value.totalUsers),
    icon: iconUser,
    tone: 'var(--text-tertiary)',
    hint: `含 ${stats.value.activeUsers} 个活跃用户`,
  },
  {
    label: '活跃用户',
    value: String(stats.value.activeUsers),
    icon: iconUser,
    tone: 'var(--color-success)',
    hint: '近期有登录或上传行为',
  },
  {
    label: '已封禁用户',
    value: String(stats.value.bannedUsers),
    icon: iconUser,
    tone: 'var(--color-danger)',
    hint: '可在用户管理中解封',
  },
  {
    label: '总文件数',
    value: String(stats.value.totalFiles),
    icon: iconFolder,
    tone: 'var(--text-tertiary)',
    hint: '全站未删除文件',
  },
  {
    label: '总存储量',
    value: formatSize(stats.value.totalStorage),
    icon: iconStorage,
    tone: 'var(--text-tertiary)',
    hint: stats.value.totalFiles > 0
      ? `平均每文件 ${formatSize(stats.value.totalStorage / stats.value.totalFiles)}`
      : '尚未占用空间',
  },
  {
    label: '全站总访问',
    value: String(stats.value.totalAccessCount),
    icon: iconEye,
    tone: 'var(--primary)',
    hint: '累计下载与预览次数',
  },
]);

let refreshTimer: number;

async function fetchData() {
  try {
    const statsRes = await api.get('/admin/stats');
    stats.value = statsRes.data.data;
  } catch { /* 保留默认值 */ }
  try {
    const myFilesRes = await api.get('/admin/my-files-stats');
    myFiles.value = myFilesRes.data.data;
  } catch { /* 保留默认值 */ }
}

function formatMonth(month: string) {
  const m = month.split('-')[1];
  const n = parseInt(m, 10);
  if (Number.isNaN(n)) return month;
  return `${n}月`;
}

// 缓存最大访问量，避免 getBarHeight 每次调用都重新 map+Math.max（O(n²)→O(n)）
const maxAccessCount = computed(() =>
  Math.max(...stats.value.monthlyAccess.map((i) => i.count), 1),
);

function getBarHeight(count: number) {
  return Math.max(4, Math.round((count / maxAccessCount.value) * 120)) + 'px';
}

onMounted(async () => {
  await fetchData();
  refreshTimer = window.setInterval(() => {
    // 后台标签页不轮询，避免空转（G15-27）
    if (document.hidden) return;
    void fetchData();
  }, 30_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
/* 固定 3 列：6 张卡正好两行；auto-fit 会在宽屏挤出 5+1 的孤行 */
.admin-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
@media (max-width: 1024px) {
  .admin-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .admin-kpi-grid { grid-template-columns: 1fr; gap: 10px; }
}

.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.stat-label { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.stat-icon { display: inline-flex; }

.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  line-height: 1.2;
}
.stat-foot { margin-top: 6px; font-size: 12px; color: var(--text-tertiary); }

.dashboard-split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  /* 卡片按内容定高，避免左卡被右卡拉伸出一大块空白 */
  align-items: start;
}

/* 三指标一行，用竖分隔线分组；窄屏自动换行且分隔线隐藏 */
.metric-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 16px;
  border-left: 1px solid var(--border-default);
}
.metric:first-child { padding-left: 0; border-left: none; }
.metric-label { font-size: 12px; color: var(--text-tertiary); }
.metric-value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

/* 空图表：用淡色占位柱 + 说明，比一行灰字更像成品 */
.chart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 0 8px;
}
.chart-empty-bars {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 72px;
  margin-bottom: 8px;
  opacity: 0.5;
}
.chart-empty-bars span {
  width: 16px;
  border-radius: 4px 4px 0 0;
  /* 用边框色而不是 muted：muted 在暗色下几乎与卡片同色，占位柱会看不见 */
  background: var(--border-default);
}
.chart-empty p { font-size: 14px; color: var(--text-secondary); }
.chart-empty-hint { font-size: 12px; color: var(--text-tertiary); }

@media (max-width: 768px) {
  .dashboard-split-grid { grid-template-columns: 1fr; }
  .metric-row { grid-template-columns: 1fr; gap: 12px; }
  .metric { padding-left: 0; border-left: none; }
}
</style>
