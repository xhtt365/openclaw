export const DEFAULT_GROUP_RELAY_FALLBACK_LIMIT = 3;

type RelayKeywordRule = {
  label: string;
  pattern: RegExp;
};

const SEQUENTIAL_RELAY_RULES: RelayKeywordRule[] = [
  { label: "接力", pattern: /接力/u },
  { label: "从你开始", pattern: /从你开始/u },
  { label: "轮流", pattern: /轮流/u },
  { label: "依次", pattern: /依次/u },
  { label: "按顺序", pattern: /按顺序/u },
  { label: "挨个", pattern: /挨个/u },
  { label: "逐个", pattern: /逐个/u },
  { label: "一个个", pattern: /一个个/u },
  { label: "一个一个", pattern: /一个一个/u },
  { label: "轮番", pattern: /轮番/u },
  { label: "下一个", pattern: /下一个(?:人|成员)?/u },
  { label: "艾特下一个", pattern: /(?:艾特|@).*下一个/u },
] as const;

const ALL_MEMBER_RULES: RelayKeywordRule[] = [
  { label: "每人", pattern: /每人/u },
  { label: "每个人", pattern: /每个(?:人|成员)?/u },
  { label: "每一个人", pattern: /每一个人/u },
  { label: "每一位", pattern: /每一位/u },
  { label: "每位", pattern: /每位/u },
  { label: "所有人", pattern: /所有人/u },
  { label: "全员", pattern: /全员/u },
  { label: "分别", pattern: /分别/u },
  { label: "各自", pattern: /各自/u },
  { label: "都来", pattern: /都来/u },
  { label: "都说", pattern: /都说/u },
  { label: "都介绍", pattern: /都介绍/u },
  { label: "都汇报", pattern: /都汇报/u },
  { label: "都做完", pattern: /都做完/u },
] as const;

const TASK_RULES: RelayKeywordRule[] = [
  { label: "自我介绍", pattern: /自我介绍/u },
  { label: "介绍", pattern: /介绍/u },
  { label: "汇报", pattern: /汇报/u },
  { label: "汇报进度", pattern: /汇报进度/u },
  { label: "逐个点评", pattern: /逐个点评/u },
  { label: "每人一句", pattern: /每人一句/u },
  { label: "报一下", pattern: /报一下/u },
  { label: "说一下", pattern: /说一下/u },
  { label: "发言", pattern: /发言/u },
  { label: "回复", pattern: /回复/u },
  { label: "回答", pattern: /回答/u },
  { label: "讲一下", pattern: /讲一下/u },
  { label: "分享", pattern: /分享/u },
] as const;

export type GroupRelayPlan = {
  leaderId: string;
  participantIds: string[];
  completedMemberIds: string[];
  fallbackCount: number;
  fallbackLimit: number;
  triggerText: string;
};

export type RelayIntentInspection = {
  isRelayRequest: boolean;
  matchedSequentialKeywords: string[];
  matchedAllMemberKeywords: string[];
  matchedTaskKeywords: string[];
};

export type RelayProgressDecision = {
  nextPlan: GroupRelayPlan | null;
  nextMemberIds: string[];
  shouldNotifyLeader: boolean;
  reason:
    | "complete"
    | "mentioned_next"
    | "leader_auto_continue"
    | "leader_fallback"
    | "fallback_limit";
};

export type AssistantRelayDecision = {
  isRelayMode: boolean;
  nextMemberIds: string[];
};

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id) => id.trim())));
}

function matchRelayKeywords(text: string, rules: readonly RelayKeywordRule[]) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

export function inspectSequentialRelayRequest(text: string, memberCount: number) {
  const normalizedText = text.trim();
  if (!normalizedText || memberCount <= 1) {
    return {
      isRelayRequest: false,
      matchedSequentialKeywords: [],
      matchedAllMemberKeywords: [],
      matchedTaskKeywords: [],
    } satisfies RelayIntentInspection;
  }

  const matchedSequentialKeywords = matchRelayKeywords(normalizedText, SEQUENTIAL_RELAY_RULES);
  const matchedAllMemberKeywords = matchRelayKeywords(normalizedText, ALL_MEMBER_RULES);
  const matchedTaskKeywords = matchRelayKeywords(normalizedText, TASK_RULES);
  const isRelayRequest =
    matchedSequentialKeywords.length > 0 ||
    (matchedAllMemberKeywords.length > 0 && matchedTaskKeywords.length > 0);

  return {
    isRelayRequest,
    matchedSequentialKeywords,
    matchedAllMemberKeywords,
    matchedTaskKeywords,
  } satisfies RelayIntentInspection;
}

export function isSequentialRelayRequest(text: string, memberCount: number) {
  return inspectSequentialRelayRequest(text, memberCount).isRelayRequest;
}

export function createSequentialRelayPlan(params: {
  text: string;
  memberIds: string[];
  leaderId: string;
  initialTargetIds: string[];
  fallbackLimit?: number;
}) {
  const participantIds = uniqueIds([...params.initialTargetIds, ...params.memberIds]);
  const inspection = inspectSequentialRelayRequest(params.text, participantIds.length);
  if (!inspection.isRelayRequest) {
    return null;
  }

  const fallbackLimit = Math.max(
    0,
    Math.floor(params.fallbackLimit ?? DEFAULT_GROUP_RELAY_FALLBACK_LIMIT),
  );

  return {
    leaderId: params.leaderId,
    participantIds,
    completedMemberIds: [],
    fallbackCount: 0,
    fallbackLimit,
    triggerText: params.text.trim(),
  } satisfies GroupRelayPlan;
}

export function getRelayRemainingMemberIds(plan: GroupRelayPlan) {
  const completed = new Set(plan.completedMemberIds);
  return plan.participantIds.filter((memberId) => !completed.has(memberId));
}

export function consumeRelayFallbackBudget(plan: GroupRelayPlan) {
  if (plan.fallbackCount >= plan.fallbackLimit) {
    return null;
  }

  return {
    ...plan,
    fallbackCount: plan.fallbackCount + 1,
  } satisfies GroupRelayPlan;
}

export function resolveRelayProgress(params: {
  plan: GroupRelayPlan;
  currentMemberId: string;
  mentionedMemberIds: string[];
}) {
  const completedMemberIds = uniqueIds([
    ...params.plan.completedMemberIds,
    ...(params.plan.participantIds.includes(params.currentMemberId)
      ? [params.currentMemberId]
      : []),
  ]);
  const nextPlan = {
    ...params.plan,
    completedMemberIds,
  } satisfies GroupRelayPlan;
  const remainingMemberIds = getRelayRemainingMemberIds(nextPlan);

  if (remainingMemberIds.length === 0) {
    return {
      nextPlan: null,
      nextMemberIds: [],
      shouldNotifyLeader: false,
      reason: "complete",
    } satisfies RelayProgressDecision;
  }

  const remainingSet = new Set(remainingMemberIds);
  const nextMentionedMemberIds = uniqueIds(params.mentionedMemberIds).filter((memberId) =>
    remainingSet.has(memberId),
  );

  if (nextMentionedMemberIds.length > 0) {
    return {
      nextPlan,
      nextMemberIds: nextMentionedMemberIds,
      shouldNotifyLeader: false,
      reason: "mentioned_next",
    } satisfies RelayProgressDecision;
  }

  if (params.currentMemberId === params.plan.leaderId) {
    return {
      nextPlan,
      nextMemberIds: [remainingMemberIds[0]],
      shouldNotifyLeader: false,
      reason: "leader_auto_continue",
    } satisfies RelayProgressDecision;
  }

  const nextFallbackPlan = consumeRelayFallbackBudget(nextPlan);
  if (!nextFallbackPlan) {
    return {
      nextPlan: null,
      nextMemberIds: [],
      shouldNotifyLeader: false,
      reason: "fallback_limit",
    } satisfies RelayProgressDecision;
  }

  return {
    nextPlan: nextFallbackPlan,
    nextMemberIds: [],
    shouldNotifyLeader: true,
    reason: "leader_fallback",
  } satisfies RelayProgressDecision;
}

// 只有用户原始消息开启接力模式后，成员回复里的 @ 才能继续触发前端自动转发。
export function resolveAssistantRelayTargets(params: {
  isRelayMode: boolean;
  mentionedMemberIds: string[];
}) {
  return {
    isRelayMode: params.isRelayMode,
    nextMemberIds: params.isRelayMode ? uniqueIds(params.mentionedMemberIds) : [],
  } satisfies AssistantRelayDecision;
}
