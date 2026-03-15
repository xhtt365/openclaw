"use client";

export const CHAT_AUTO_SCROLL_THRESHOLD_PX = 48;

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
