import { calculateConfidence } from "./confidenceCalculator";
import { inspectSequentialRelayRequest } from "./taskTypeRecognizer";

type FeedbackRule = {
  keyword: string;
  normalizedKeyword: string;
};

const NEGATIVE_RULES: readonly FeedbackRule[] = [
  { keyword: "错了", normalizedKeyword: "错" },
  { keyword: "不对吧", normalizedKeyword: "不对吧" },
  { keyword: "不对", normalizedKeyword: "不对" },
  { keyword: "不是", normalizedKeyword: "不是" },
  { keyword: "漏了", normalizedKeyword: "漏了" },
  { keyword: "应该先", normalizedKeyword: "应该先" },
  { keyword: "重新来", normalizedKeyword: "重新来" },
  { keyword: "重新", normalizedKeyword: "重新来" },
  { keyword: "不可以", normalizedKeyword: "不可以" },
  { keyword: "不能这样", normalizedKeyword: "不能这样" },
  { keyword: "不行", normalizedKeyword: "不行" },
  { keyword: "等等", normalizedKeyword: "重新来" },
  { keyword: "停", normalizedKeyword: "停" },
] as const;

const POSITIVE_EXPLICIT_RULES: readonly FeedbackRule[] = [
  { keyword: "正是", normalizedKeyword: "正是" },
  { keyword: "这就是", normalizedKeyword: "这就是" },
  { keyword: "完美", normalizedKeyword: "完美" },
  { keyword: "太对了", normalizedKeyword: "太对了" },
  { keyword: "完全正确", normalizedKeyword: "完全正确" },
] as const;

const POSITIVE_WEAK_RULES: readonly FeedbackRule[] = [
  { keyword: "谢谢", normalizedKeyword: "谢谢" },
  { keyword: "好的", normalizedKeyword: "好" },
  { keyword: "可以", normalizedKeyword: "可以" },
  { keyword: "继续", normalizedKeyword: "继续" },
  { keyword: "嗯", normalizedKeyword: "嗯" },
  { keyword: "对", normalizedKeyword: "对" },
  { keyword: "知道了", normalizedKeyword: "知道了" },
  { keyword: "了解", normalizedKeyword: "了解" },
  { keyword: "明白了", normalizedKeyword: "明白" },
  { keyword: "明白", normalizedKeyword: "明白" },
] as const;

const POLITE_RULES: readonly string[] = [
  "好的",
  "谢谢",
  "感谢",
  "麻烦",
  "请问",
  "不好意思",
] as const;

export type FeedbackClassification = {
  type: "negative_explicit" | "positive_explicit" | "positive_weak" | "neutral";
  keywords: string[];
  confidence: number;
};

function matchKeywords(text: string, rules: readonly FeedbackRule[]) {
  return rules.filter((rule) => text.includes(rule.keyword)).map((rule) => rule.normalizedKeyword);
}

function uniqueKeywords(keywords: string[]) {
  return Array.from(new Set(keywords));
}

function shouldApplyPositiveWeakPolitePenalty(
  text: string,
  matchedPositiveWeakKeywords: string[],
  isPoliteResponse: boolean,
) {
  if (!isPoliteResponse) {
    return false;
  }

  if (matchedPositiveWeakKeywords.length >= 2) {
    return true;
  }

  return text.includes("好的");
}

/**
 * 根据文本内容识别反馈类型，并提取命中的反馈关键词与任务关键词。
 */
export function classifyFeedback(text: string): FeedbackClassification {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      type: "neutral",
      keywords: [],
      confidence: calculateConfidence({ feedbackType: "neutral" }),
    };
  }

  const matchedNegativeKeywords = matchKeywords(normalizedText, NEGATIVE_RULES);
  const matchedPositiveExplicitKeywords = matchKeywords(normalizedText, POSITIVE_EXPLICIT_RULES);
  const matchedPositiveWeakKeywords = matchKeywords(normalizedText, POSITIVE_WEAK_RULES);
  const { matchedTaskKeywords } = inspectSequentialRelayRequest(normalizedText);
  const isPoliteResponse = POLITE_RULES.some((keyword) => normalizedText.includes(keyword));

  if (matchedNegativeKeywords.length > 0) {
    const keywords = uniqueKeywords([...matchedNegativeKeywords, ...matchedTaskKeywords]);
    return {
      type: "negative_explicit",
      keywords,
      confidence: calculateConfidence({
        feedbackType: "negative_explicit",
        isPoliteResponse,
      }),
    };
  }

  if (matchedPositiveExplicitKeywords.length > 0) {
    const keywords = uniqueKeywords([...matchedPositiveExplicitKeywords, ...matchedTaskKeywords]);
    return {
      type: "positive_explicit",
      keywords,
      confidence: calculateConfidence({
        feedbackType: "positive_explicit",
        isPoliteResponse,
      }),
    };
  }

  if (matchedPositiveWeakKeywords.length > 0) {
    const keywords = uniqueKeywords([...matchedPositiveWeakKeywords, ...matchedTaskKeywords]);
    return {
      type: "positive_weak",
      keywords,
      confidence: calculateConfidence({
        feedbackType: "positive_weak",
        isPoliteResponse: shouldApplyPositiveWeakPolitePenalty(
          normalizedText,
          matchedPositiveWeakKeywords,
          isPoliteResponse,
        ),
      }),
    };
  }

  return {
    type: "neutral",
    keywords: matchedTaskKeywords,
    confidence: calculateConfidence({ feedbackType: "neutral" }),
  };
}
