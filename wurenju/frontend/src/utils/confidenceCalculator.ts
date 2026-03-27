const CONFIDENCE_RULES = {
  negative_explicit: {
    baseScore: 0.8,
    increment: 0.05,
    maxIncrement: 0.2,
    politePenalty: 0.1,
  },
  positive_explicit: {
    baseScore: 0.7,
    increment: 0.05,
    maxIncrement: 0.2,
    politePenalty: 0.1,
  },
  positive_weak: {
    baseScore: 0.5,
    increment: 0.02,
    maxIncrement: 0.1,
    politePenalty: 0.1,
  },
  neutral: {
    baseScore: 0.3,
    increment: 0,
    maxIncrement: 0,
    politePenalty: 0,
  },
} as const;

export type ConfidenceParams = {
  feedbackType: string;
  repeatedHits?: number;
  isPoliteResponse?: boolean;
  timeDecay?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * 根据反馈类型、重复命中和礼貌表达计算经验置信度。
 */
export function calculateConfidence(params: ConfidenceParams): number {
  const rule =
    CONFIDENCE_RULES[params.feedbackType as keyof typeof CONFIDENCE_RULES] ??
    CONFIDENCE_RULES.neutral;
  const repeatedHits = Math.max(0, params.repeatedHits ?? 0);
  const bonus = Math.min(Math.max(0, repeatedHits - 1) * rule.increment, rule.maxIncrement);
  const penalty = params.isPoliteResponse ? rule.politePenalty : 0;
  const decayedScore = (rule.baseScore + bonus - penalty) * (params.timeDecay ?? 1);
  return roundConfidence(clamp(decayedScore, 0.1, 0.95));
}
