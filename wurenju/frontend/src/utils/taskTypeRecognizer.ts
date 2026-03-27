type TaskKeywordRule = {
  label: string;
  pattern: RegExp;
};

const TASK_TYPE_RULES: readonly TaskKeywordRule[] = [
  { label: "介绍", pattern: /介绍/u },
  { label: "说明", pattern: /说明/u },
  { label: "讲解", pattern: /讲解/u },
  { label: "展示", pattern: /展示/u },
  { label: "汇报进度", pattern: /(?:汇报|报告|总结|述职)(?:一下)?(?:本周|当前|今日|最近)?进度/u },
  { label: "汇报", pattern: /汇报/u },
  { label: "报告", pattern: /报告/u },
  { label: "总结", pattern: /总结/u },
  { label: "述职", pattern: /述职/u },
  { label: "写", pattern: /写/u },
  { label: "创作", pattern: /创作/u },
  { label: "生成", pattern: /生成/u },
  { label: "制作", pattern: /制作/u },
  { label: "问", pattern: /问/u },
  { label: "回答", pattern: /回答/u },
  { label: "解释", pattern: /解释/u },
  { label: "告诉", pattern: /告诉/u },
  { label: "做", pattern: /做/u },
  { label: "执行", pattern: /执行/u },
  { label: "完成", pattern: /完成/u },
  { label: "处理", pattern: /处理/u },
] as const;

export type TaskTypeInspection = {
  matchedTaskKeywords: string[];
  hasClearIntent: boolean;
};

function uniqueKeywords(keywords: string[]) {
  return Array.from(new Set(keywords));
}

function normalizeMatchedTaskKeywords(keywords: string[]) {
  if (!keywords.includes("汇报进度")) {
    return keywords;
  }

  return keywords.filter((keyword) => !["汇报", "报告", "总结", "述职"].includes(keyword));
}

/**
 * 检查文本中是否包含明确的任务类型意图。
 */
export function inspectSequentialRelayRequest(text: string): TaskTypeInspection {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      matchedTaskKeywords: [],
      hasClearIntent: false,
    };
  }

  const matchedTaskKeywords = normalizeMatchedTaskKeywords(
    uniqueKeywords(
      TASK_TYPE_RULES.filter((rule) => rule.pattern.test(normalizedText)).map((rule) => rule.label),
    ),
  );

  return {
    matchedTaskKeywords,
    hasClearIntent: matchedTaskKeywords.length > 0,
  };
}
