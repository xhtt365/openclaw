"use client";

// 对齐 OpenClaw 原版 `ui/src/ui/app-scroll.ts` 的“接近底部”判定，
// 避免用户视觉上仍在底部附近时被误判成已经离底。
export const CHAT_AUTO_SCROLL_THRESHOLD_PX = 450;

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export function isScrollNearBottom(
  metrics: ScrollMetrics,
  threshold = CHAT_AUTO_SCROLL_THRESHOLD_PX,
) {
  return metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight) <= threshold;
}

export function getShouldStickToBottomOnWheel(
  metrics: ScrollMetrics,
  deltaY: number,
  threshold = CHAT_AUTO_SCROLL_THRESHOLD_PX,
) {
  if (deltaY < 0) {
    return false;
  }

  return isScrollNearBottom(metrics, threshold);
}

export function getScrollBottomTop(metrics: Pick<ScrollMetrics, "clientHeight" | "scrollHeight">) {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}
