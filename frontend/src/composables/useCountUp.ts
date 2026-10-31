import { onUnmounted, ref, watch, type Ref } from 'vue';

interface CountUpOptions {
  /** 动画时长（毫秒）。默认 520ms：足够看清变化，又不拖慢感知。 */
  durationMs?: number;
  /** 是否随目标值反向（减少）也做动画。默认 true。 */
  animateDown?: boolean;
}

/** easeOutCubic：结尾减速，符合"到达"的语义（见动效规范：进入用减速曲线）。 */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 数值滚动。
 *
 * 用途：仪表盘等"数字会变"的位置。逐帧用 transform 无关的纯数值插值，
 * 天然不触发重排（只改文本节点），也不会造成 CLS——前提是容器本身宽度稳定，
 * 配合 `font-variant-numeric: tabular-nums` 使用。
 *
 * 无障碍：`prefers-reduced-motion: reduce` 时直接跳到目标值，不做动画。
 * 变化中途再次变更目标值时，取消旧动画并从"当前显示值"继续，避免跳变。
 */
export function useCountUp(target: Ref<number>, options: CountUpOptions = {}) {
  const { durationMs = 520, animateDown = true } = options;
  const display = ref(0);
  let frame: number | null = null;

  const cancel = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const run = (to: number) => {
    cancel();
    const from = display.value;
    if (to === from) return;
    if (prefersReducedMotion() || (!animateDown && to < from)) {
      display.value = to;
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const value = from + (to - from) * easeOutCubic(progress);
      display.value = progress >= 1 ? to : value;
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        frame = null;
      }
    };
    frame = requestAnimationFrame(step);
  };

  watch(target, (value) => run(Number.isFinite(value) ? value : 0), { immediate: true });
  onUnmounted(cancel);

  return display;
}
