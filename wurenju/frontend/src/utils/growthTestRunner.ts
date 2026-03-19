import { gateway } from "@/services/gateway";
import { useAchievementStore } from "@/stores/achievementStore";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useExperienceStore } from "@/stores/experienceStore";
import { useGrowthStore } from "@/stores/growthStore";
import { useHealthStore } from "@/stores/healthStore";
import { usePromptVersionStore } from "@/stores/promptVersionStore";
import { useStatsStore } from "@/stores/statsStore";
import type { PromptVersion } from "@/types/growth";
import { createEmptyHealthRecord } from "@/utils/health";
import { createHourlyStatsKey, resolveHourlyBucket, type HourlyStats } from "@/utils/stats";

type GrowthTestCaseResult = {
  name: string;
  pass: boolean;
  detail: string;
};

export type GrowthTestSummary = {
  passed: number;
  failed: number;
  failedItems: string[];
  results: GrowthTestCaseResult[];
};

type TestStatsInput = {
  agentId: string;
  timestamp: number;
  messageCount: number;
  turnCount: number;
  tokenTotal: number;
  errorCount: number;
  avgResponseMs: number;
  modelUsed?: string | null;
};

type StoreSnapshots = {
  achievement: ReturnType<typeof useAchievementStore.getState>;
  agent: ReturnType<typeof useAgentStore.getState>;
  chat: ReturnType<typeof useChatStore.getState>;
  experience: ReturnType<typeof useExperienceStore.getState>;
  growth: ReturnType<typeof useGrowthStore.getState>;
  health: ReturnType<typeof useHealthStore.getState>;
  promptVersion: ReturnType<typeof usePromptVersionStore.getState>;
  stats: ReturnType<typeof useStatsStore.getState>;
};

let growthTestsRunning = false;

function log(message: string) {
  console.log(`[GrowthTest] ${message}`);
}

function cloneMap<T>(input: Map<string, T>, cloneValue: (value: T) => T) {
  return new Map(Array.from(input.entries(), ([key, value]) => [key, cloneValue(value)] as const));
}

function createStatsEntry(params: TestStatsInput): HourlyStats {
  const bucket = resolveHourlyBucket(params.timestamp);
  const modelUsed = params.modelUsed ?? "openai/gpt-5.4";
  return {
    id: createHourlyStatsKey(params.agentId, bucket.date, bucket.hour),
    agentId: params.agentId,
    date: bucket.date,
    hour: bucket.hour,
    bucketStartAt: bucket.bucketStartAt,
    messageCount: params.messageCount,
    turnCount: params.turnCount,
    tokenInput: Math.round(params.tokenTotal * 0.55),
    tokenOutput: Math.round(params.tokenTotal * 0.35),
    tokenCacheRead: Math.round(params.tokenTotal * 0.08),
    tokenCacheWrite: Math.max(0, params.tokenTotal - Math.round(params.tokenTotal * 0.98)),
    tokenTotal: params.tokenTotal,
    totalResponseMs: params.avgResponseMs * Math.max(params.messageCount, 1),
    responseSampleCount: Math.max(params.messageCount, 1),
    avgResponseMs: params.avgResponseMs,
    errorCount: params.errorCount,
    fallbackCount: 0,
    modelUsed,
    modelCounts: modelUsed ? { [modelUsed]: params.turnCount } : {},
    updatedAt: params.timestamp,
  };
}

function createHistoryMessage(
  role: "user" | "assistant",
  content: string,
  timestamp: number,
  usage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  },
) {
  return {
    id: crypto.randomUUID(),
    role,
    timestamp,
    content: [{ type: "text", text: content }],
    usage: usage
      ? {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens:
            usage.totalTokens ??
            usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
        }
      : undefined,
    model: "openai/gpt-5.4",
    provider: "openai",
  };
}

function buildDefaultReviewReply(suggestion: string) {
  return [
    "1. 本周做得最好的是把需求梳理得更清楚，减少了重复确认。",
    "2. 最大不足是遇到异常时排查顺序还不够稳定，导致少量错误没有第一时间压住。",
    `3. 改进建议：${suggestion}`,
  ].join("\n");
}

function buildPeerTeachReply() {
  return [
    "1. 这个方法适合我。",
    "2. 我会把排查顺序前置到首轮回复前的检查清单里。",
    "3. 改进建议：先核对错误清单，再决定是否继续输出。",
  ].join("\n");
}

function captureStoreSnapshots(): StoreSnapshots {
  const achievement = useAchievementStore.getState();
  const agent = useAgentStore.getState();
  const chat = useChatStore.getState();
  const experience = useExperienceStore.getState();
  const growth = useGrowthStore.getState();
  const health = useHealthStore.getState();
  const promptVersion = usePromptVersionStore.getState();
  const stats = useStatsStore.getState();

  return {
    achievement: {
      ...achievement,
      definitions: [...achievement.definitions],
      unlocks: achievement.unlocks.map((item) => ({ ...item })),
      rankingSnapshots: achievement.rankingSnapshots.map((item) => ({
        ...item,
        items: item.items.map((entry) => ({
          ...entry,
          metrics: {
            ...entry.metrics,
            errorTypes: { ...entry.metrics.errorTypes },
            modelCounts: { ...entry.metrics.modelCounts },
          },
          breakdown: { ...entry.breakdown },
        })),
      })),
    },
    agent: {
      ...agent,
      agents: agent.agents.map((item) => ({ ...item })),
      agentFiles: cloneMap(agent.agentFiles, (files) => files.map((file) => ({ ...file }))),
      availableModels: [...agent.availableModels],
    },
    chat: {
      ...chat,
      messagesByAgentId: cloneMap(chat.messagesByAgentId, (messages) =>
        messages.map((message) => ({
          ...message,
          usage: message.usage
            ? {
                ...message.usage,
                cost: message.usage.cost ? { ...message.usage.cost } : undefined,
              }
            : undefined,
        })),
      ),
      usageByAgentId: cloneMap(chat.usageByAgentId, (usage) => ({
        ...usage,
        cost: usage.cost ? { ...usage.cost } : undefined,
      })),
      contextWindowSizeByAgentId: new Map(chat.contextWindowSizeByAgentId),
      currentContextUsedByAgentId: new Map(chat.currentContextUsedByAgentId),
      historyLoadedByAgentId: new Map(chat.historyLoadedByAgentId),
      historyLoadingByAgentId: new Map(chat.historyLoadingByAgentId),
    },
    experience: {
      ...experience,
      entries: experience.entries.map((item) => ({
        ...item,
        appliedTo: [...item.appliedTo],
        metrics: {
          before: {
            ...item.metrics.before,
            errorTypes: { ...item.metrics.before.errorTypes },
            modelCounts: { ...item.metrics.before.modelCounts },
          },
          after: item.metrics.after
            ? {
                ...item.metrics.after,
                errorTypes: { ...item.metrics.after.errorTypes },
                modelCounts: { ...item.metrics.after.modelCounts },
              }
            : undefined,
        },
      })),
      teachingDispatches: experience.teachingDispatches.map((item) => ({ ...item })),
    },
    growth: {
      ...growth,
      reviewSchedule: { ...growth.reviewSchedule },
      reviews: growth.reviews.map((item) => ({
        ...item,
        snapshot: {
          ...item.snapshot,
          metrics: {
            ...item.snapshot.metrics,
            errorTypes: { ...item.snapshot.metrics.errorTypes },
            modelCounts: { ...item.snapshot.metrics.modelCounts },
          },
        },
        previousSnapshot: item.previousSnapshot
          ? {
              ...item.previousSnapshot,
              metrics: {
                ...item.previousSnapshot.metrics,
                errorTypes: { ...item.previousSnapshot.metrics.errorTypes },
                modelCounts: { ...item.previousSnapshot.metrics.modelCounts },
              },
            }
          : null,
      })),
      weeklySnapshots: growth.weeklySnapshots.map((item) => ({
        ...item,
        metrics: {
          ...item.metrics,
          errorTypes: { ...item.metrics.errorTypes },
          modelCounts: { ...item.metrics.modelCounts },
        },
      })),
      events: growth.events.map((item) => ({ ...item })),
      lastScheduledReviewSlotByAgentId: { ...growth.lastScheduledReviewSlotByAgentId },
    },
    health: {
      ...health,
      recordsByAgentId: Object.fromEntries(
        Object.entries(health.recordsByAgentId).map(([agentId, record]) => [
          agentId,
          {
            ...record,
            interactions: record.interactions.map((item) => ({ ...item })),
            usageSnapshots: record.usageSnapshots.map((item) => ({ ...item })),
            fallbackEvents: record.fallbackEvents.map((item) => ({
              ...item,
              attempts: [...item.attempts],
            })),
            alerts: record.alerts.map((item) => ({ ...item })),
            alertFlags: { ...record.alertFlags },
            summary: {
              ...record.summary,
              issues: record.summary.issues.map((item) => ({ ...item })),
            },
          },
        ]),
      ),
      alerts: health.alerts.map((item) => ({ ...item })),
    },
    promptVersion: {
      ...promptVersion,
      versions: promptVersion.versions.map((item) => ({
        ...item,
        metrics: {
          ...item.metrics,
          errorTypes: { ...item.metrics.errorTypes },
          modelCounts: { ...item.metrics.modelCounts },
        },
      })),
      rollbackRecords: promptVersion.rollbackRecords.map((item) => ({
        ...item,
        metricsBeforeRollback: {
          ...item.metricsBeforeRollback,
          errorTypes: { ...item.metricsBeforeRollback.errorTypes },
          modelCounts: { ...item.metricsBeforeRollback.modelCounts },
        },
      })),
      activeVersionIdByKey: { ...promptVersion.activeVersionIdByKey },
    },
    stats: {
      ...stats,
      hourlyStatsByKey: Object.fromEntries(
        Object.entries(stats.hourlyStatsByKey).map(([key, value]) => [key, { ...value }]),
      ),
      syncCursorByAgentId: Object.fromEntries(
        Object.entries(stats.syncCursorByAgentId).map(([key, value]) => [key, { ...value }]),
      ),
    },
  };
}

function restoreStoreSnapshots(snapshots: StoreSnapshots) {
  useAchievementStore.setState(snapshots.achievement);
  useAgentStore.setState(snapshots.agent);
  useChatStore.setState(snapshots.chat);
  useExperienceStore.setState(snapshots.experience);
  useGrowthStore.setState(snapshots.growth);
  useHealthStore.setState(snapshots.health);
  usePromptVersionStore.setState(snapshots.promptVersion);
  useStatsStore.setState(snapshots.stats);
}

function buildPromptKey(agentId: string, fileName: "IDENTITY.md" | "SOUL.md") {
  return `${agentId}:${fileName}`;
}

function replaceStats(entries: TestStatsInput[], agentIds: string[]) {
  const hourlyStatsByKey = Object.fromEntries(
    entries.map((entry) => {
      const next = createStatsEntry(entry);
      return [next.id, next] as const;
    }),
  );

  const recordsByAgentId = Object.fromEntries(
    agentIds.map((agentId) => {
      const record = createEmptyHealthRecord();
      record.summary = {
        ...record.summary,
        score: 88,
        level: "healthy",
        hasRecentData: entries.some((entry) => entry.agentId === agentId),
      };
      return [agentId, record] as const;
    }),
  );

  useStatsStore.setState({
    hourlyStatsByKey,
    syncCursorByAgentId: {},
  });
  useHealthStore.setState({
    recordsByAgentId,
    alerts: [],
  });
}

function getLatestPendingReview(agentId: string) {
  return useGrowthStore
    .getState()
    .getReviewsForAgent(agentId)
    .find((review) => review.status === "pending_approval");
}

function getLatestExperienceEntry(agentId: string) {
  return useExperienceStore.getState().entries.find((entry) => entry.source === agentId);
}

function recordResult(
  results: GrowthTestCaseResult[],
  name: string,
  pass: boolean,
  detail: string,
) {
  const line = `${pass ? "✅" : "❌"} ${name} — ${detail}`;
  log(line);
  results.push({ name, pass, detail });
}

export async function runGrowthTests(): Promise<GrowthTestSummary> {
  if (growthTestsRunning) {
    const summary = {
      passed: 0,
      failed: 1,
      failedItems: ["测试已在运行中"],
      results: [
        {
          name: "测试已在运行中",
          pass: false,
          detail: "请等待当前 GrowthTest 执行完成。",
        },
      ],
    } satisfies GrowthTestSummary;
    log("已有一轮测试在执行，跳过本次请求。");
    return summary;
  }

  growthTestsRunning = true;
  const results: GrowthTestCaseResult[] = [];
  const snapshots = captureStoreSnapshots();
  const originalDateNow = Date.now;
  const originalSendChat = gateway.sendChat.bind(gateway);
  const originalLoadHistory = gateway.loadHistory.bind(gateway);
  const originalGetAgentFile = gateway.getAgentFile.bind(gateway);
  const originalSaveAgentFile = gateway.saveAgentFile.bind(gateway);

  let fakeNow = Date.parse("2026-03-19T12:00:00+08:00");
  Date.now = () => fakeNow;

  const sessionMessages = new Map<string, ReturnType<typeof createHistoryMessage>[]>();
  const agentFiles = new Map<string, string>();
  const promptHistoryByAgentId = new Map<string, string[]>();
  const replyQueueByAgentId = new Map<string, string[]>();

  const sourceAgent: Agent = {
    id: "agent-growth-alpha",
    name: "阿虾",
    emoji: "🦞",
    role: "客服员工",
  };
  const targetAgent: Agent = {
    id: "agent-growth-beta",
    name: "小贝",
    emoji: "🐚",
    role: "销售员工",
  };
  const observerAgent: Agent = {
    id: "agent-growth-gamma",
    name: "小钳",
    emoji: "🦀",
    role: "运营员工",
  };
  const testAgents = [sourceAgent, targetAgent, observerAgent];
  const baseIdentity = ["# 阿虾", "", "- Role: 客服员工", "- Style: 先确认，再行动"].join("\n");
  const baselineVersionId = crypto.randomUUID();

  function queueReply(agentId: string, reply: string) {
    const current = replyQueueByAgentId.get(agentId) ?? [];
    replyQueueByAgentId.set(agentId, [...current, reply]);
  }

  function pushPrompt(agentId: string, prompt: string) {
    const current = promptHistoryByAgentId.get(agentId) ?? [];
    promptHistoryByAgentId.set(agentId, [...current, prompt]);
  }

  function nextReply(agentId: string, prompt: string) {
    const current = replyQueueByAgentId.get(agentId) ?? [];
    const [reply, ...rest] = current;
    replyQueueByAgentId.set(agentId, rest);

    if (reply) {
      return reply;
    }

    if (prompt.includes("同事带教")) {
      return buildPeerTeachReply();
    }

    return buildDefaultReviewReply("把错误排查清单写进 IDENTITY.md，先查超时再查上下文。");
  }

  function currentSessionMessages(sessionKey: string) {
    return sessionMessages.get(sessionKey) ?? [];
  }

  gateway.sendChat = (async (text, sessionKey) => {
    const agentId = sessionKey.split(":")[1]?.trim() || sessionKey;
    pushPrompt(agentId, text);

    const nextMessages = [
      ...currentSessionMessages(sessionKey),
      createHistoryMessage("user", text, fakeNow),
      createHistoryMessage("assistant", nextReply(agentId, text), fakeNow + 1, {
        input: 320,
        output: 160,
        totalTokens: 480,
      }),
    ];
    sessionMessages.set(sessionKey, nextMessages);

    return {
      type: "res" as const,
      id: crypto.randomUUID(),
      ok: true,
      payload: {},
    };
  }) as typeof gateway.sendChat;

  gateway.loadHistory = (async (sessionKey, limit = 200) => {
    return {
      sessionKey,
      messages: currentSessionMessages(sessionKey).slice(-limit),
    };
  }) as typeof gateway.loadHistory;

  gateway.getAgentFile = (async (agentId, fileName) => {
    return agentFiles.get(buildPromptKey(agentId, fileName)) ?? "";
  }) as typeof gateway.getAgentFile;

  gateway.saveAgentFile = (async (agentId, fileName, content) => {
    agentFiles.set(buildPromptKey(agentId, fileName), content);
    return true;
  }) as typeof gateway.saveAgentFile;

  try {
    useAgentStore.setState({
      agents: testAgents,
      currentAgentId: sourceAgent.id,
      mainKey: "main",
      showDetailFor: null,
      agentFiles: new Map(
        testAgents.map((agent) => [
          agent.id,
          [
            {
              name: "IDENTITY.md",
              size: new TextEncoder().encode(baseIdentity).length,
              updatedAtMs: fakeNow,
              content: baseIdentity,
            },
          ],
        ]),
      ),
    });
    useChatStore.setState({
      messagesByAgentId: new Map(),
      usageByAgentId: new Map(),
      contextWindowSizeByAgentId: new Map(),
      currentContextUsedByAgentId: new Map(),
      historyLoadedByAgentId: new Map(),
      historyLoadingByAgentId: new Map(),
      activeReplyAgentId: null,
      status: "connected",
    });
    useGrowthStore.setState({
      reviews: [],
      weeklySnapshots: [],
      events: [],
      lastScheduledReviewSlotByAgentId: {},
    });
    useExperienceStore.setState({
      entries: [],
      teachingDispatches: [],
    });
    useAchievementStore.setState({
      unlocks: [],
      rankingSnapshots: [],
    });
    usePromptVersionStore.setState({
      versions: [
        {
          id: baselineVersionId,
          version: "v1.0",
          agentId: sourceAgent.id,
          fileName: "IDENTITY.md",
          timestamp: new Date(fakeNow - 60_000).toISOString(),
          changeDescription: "初始基线版本",
          content: baseIdentity,
          source: "manual",
          metrics: {
            agentId: sourceAgent.id,
            label: "baseline",
            startAt: fakeNow - 7 * 24 * 60 * 60 * 1000,
            endAt: fakeNow,
            sampleDays: 7,
            messageCount: 0,
            turnCount: 0,
            avgResponseMs: null,
            errorCount: 0,
            errorRate: 0,
            errorTypes: {},
            tokenTotal: 0,
            tokenEfficiency: null,
            tokenPerMessage: null,
            healthScore: 88,
            healthLevel: "healthy",
            modelUsed: null,
            mainModel: null,
            backupModel: null,
            fallbackCount: 0,
            modelCounts: {},
          },
        } satisfies PromptVersion,
      ],
      rollbackRecords: [],
      activeVersionIdByKey: {
        [buildPromptKey(sourceAgent.id, "IDENTITY.md")]: baselineVersionId,
      },
    });

    for (const agent of testAgents) {
      agentFiles.set(buildPromptKey(agent.id, "IDENTITY.md"), baseIdentity);
    }

    replaceStats(
      [
        {
          agentId: sourceAgent.id,
          timestamp: Date.parse("2026-03-18T10:00:00+08:00"),
          messageCount: 48,
          turnCount: 52,
          tokenTotal: 3600,
          errorCount: 6,
          avgResponseMs: 1800,
        },
        {
          agentId: targetAgent.id,
          timestamp: Date.parse("2026-03-18T11:00:00+08:00"),
          messageCount: 12,
          turnCount: 14,
          tokenTotal: 1800,
          errorCount: 2,
          avgResponseMs: 2400,
        },
      ],
      testAgents.map((agent) => agent.id),
    );

    queueReply(
      sourceAgent.id,
      buildDefaultReviewReply("把错误排查清单写进 IDENTITY.md，先查超时再查上下文。"),
    );

    const createdReviews = await useGrowthStore.getState().runWeeklyReviews({
      agentId: sourceAgent.id,
      force: true,
      trigger: "manual",
    });
    const createdReview = createdReviews[0] ?? null;
    const weeklyPrompt = promptHistoryByAgentId.get(sourceAgent.id)?.at(-1) ?? "";

    recordResult(
      results,
      "触发周报",
      Boolean(
        createdReview &&
        weeklyPrompt.includes("消息量：48 条") &&
        weeklyPrompt.includes("对话轮次：52 轮") &&
        weeklyPrompt.includes("Token 消耗：3.6K") &&
        weeklyPrompt.includes("错误次数：6 次") &&
        weeklyPrompt.includes("平均延迟：1800ms"),
      ),
      createdReview ? "已注入真实 statsStore 数据并生成自评任务" : "未生成周报记录",
    );

    const chatMessagesAfterReview = useChatStore.getState().getMessagesForAgent(sourceAgent.id);
    const chatHasReviewReply = chatMessagesAfterReview.some((message) =>
      message.content.includes("把错误排查清单写进 IDENTITY.md"),
    );
    recordResult(
      results,
      "聊天流自评",
      chatHasReviewReply,
      chatHasReviewReply ? "1v1 聊天流已出现员工自评回复" : "聊天流未找到自评回复",
    );

    const growthReviewAfterRun = useGrowthStore
      .getState()
      .getReviewsForAgent(sourceAgent.id)
      .find((review) => review.id === createdReview?.id);
    const syncedToPanel =
      growthReviewAfterRun?.report.includes("把错误排查清单写进 IDENTITY.md") ?? false;
    recordResult(
      results,
      "成长面板自评",
      syncedToPanel,
      syncedToPanel ? "growthStore 已保存自评记录" : "growthStore 未保存自评记录",
    );

    const versionCountBeforeApply = usePromptVersionStore
      .getState()
      .getVersionsForAgent(sourceAgent.id).length;
    const identityBeforeApply = agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";

    if (createdReview) {
      await useGrowthStore.getState().applyReviewSuggestion(createdReview.id);
    }

    const identityAfterApply = agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";
    const appliedEntry = getLatestExperienceEntry(sourceAgent.id);
    const applyPassed =
      identityAfterApply.includes("把错误排查清单写进 IDENTITY.md，先查超时再查上下文。") &&
      appliedEntry?.status === "pending";
    recordResult(
      results,
      "应用建议",
      Boolean(applyPassed),
      applyPassed ? "IDENTITY.md 已更新，经验条目进入待验证" : "IDENTITY.md 未按预期更新",
    );

    queueReply(sourceAgent.id, buildDefaultReviewReply("把常见错误原因整理成一张值班速查表。"));
    const rejectReviews = await useGrowthStore.getState().runWeeklyReviews({
      agentId: sourceAgent.id,
      force: true,
      trigger: "manual",
    });
    const rejectReview = rejectReviews[0] ?? getLatestPendingReview(sourceAgent.id) ?? null;
    const identityBeforeReject =
      agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";

    if (rejectReview) {
      await useGrowthStore.getState().rejectReviewSuggestion(rejectReview.id);
    }

    const rejectedReview = rejectReview
      ? useGrowthStore.getState().reviews.find((review) => review.id === rejectReview.id)
      : null;
    const identityAfterReject = agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";
    const rejectPassed =
      rejectedReview?.status === "rejected" && identityBeforeReject === identityAfterReject;
    recordResult(
      results,
      "驳回建议",
      Boolean(rejectPassed),
      rejectPassed ? "建议已标记为已驳回，IDENTITY.md 保持不变" : "驳回后状态或文件内容异常",
    );

    const versionsAfterApply = usePromptVersionStore.getState().getVersionsForAgent(sourceAgent.id);
    const backupPassed =
      versionsAfterApply.length === versionCountBeforeApply + 1 &&
      versionsAfterApply.some((version) => version.content === identityBeforeApply);
    recordResult(
      results,
      "版本备份",
      backupPassed,
      backupPassed ? "版本历史新增 1 条，且保留了应用前内容" : "版本历史未正确备份旧内容",
    );

    fakeNow = Date.parse("2026-03-26T12:00:00+08:00");
    replaceStats(
      [
        {
          agentId: sourceAgent.id,
          timestamp: Date.parse("2026-03-25T10:00:00+08:00"),
          messageCount: 50,
          turnCount: 54,
          tokenTotal: 3550,
          errorCount: 3,
          avgResponseMs: 1500,
        },
      ],
      testAgents.map((agent) => agent.id),
    );

    await useGrowthStore.getState().evaluatePendingChanges({
      force: true,
      agentId: sourceAgent.id,
    });

    const verifiedEntry = getLatestExperienceEntry(sourceAgent.id);
    const verifiedReview =
      createdReview &&
      useGrowthStore.getState().reviews.find((review) => review.id === createdReview.id);
    const verifyImprovedPassed =
      verifiedEntry?.status === "verified" && verifiedReview?.status === "verified";
    recordResult(
      results,
      "验证效果-改善",
      Boolean(verifyImprovedPassed),
      verifyImprovedPassed ? "建议已标记为已验证" : "建议未被标记为已验证",
    );

    fakeNow = Date.parse("2026-03-27T12:00:00+08:00");
    replaceStats(
      [
        {
          agentId: sourceAgent.id,
          timestamp: Date.parse("2026-03-27T09:00:00+08:00"),
          messageCount: 42,
          turnCount: 44,
          tokenTotal: 3400,
          errorCount: 3,
          avgResponseMs: 1600,
        },
      ],
      testAgents.map((agent) => agent.id),
    );
    queueReply(sourceAgent.id, buildDefaultReviewReply("把高频错误做成回访前的固定核对步骤。"));

    const rollbackReviews = await useGrowthStore.getState().runWeeklyReviews({
      agentId: sourceAgent.id,
      force: true,
      trigger: "manual",
    });
    const rollbackReview = rollbackReviews[0] ?? getLatestPendingReview(sourceAgent.id) ?? null;
    const contentBeforeRollbackApply =
      agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";

    if (rollbackReview) {
      await useGrowthStore.getState().applyReviewSuggestion(rollbackReview.id);
    }

    const activeVersionBeforeRollback = usePromptVersionStore
      .getState()
      .getActiveVersionId(sourceAgent.id, "IDENTITY.md");
    fakeNow = Date.parse("2026-04-03T12:00:00+08:00");
    replaceStats(
      [
        {
          agentId: sourceAgent.id,
          timestamp: Date.parse("2026-04-02T10:00:00+08:00"),
          messageCount: 40,
          turnCount: 45,
          tokenTotal: 3650,
          errorCount: 15,
          avgResponseMs: 3200,
        },
      ],
      testAgents.map((agent) => agent.id),
    );

    await useGrowthStore.getState().evaluatePendingChanges({
      force: true,
      agentId: sourceAgent.id,
    });

    const activeVersionAfterRollback = usePromptVersionStore
      .getState()
      .getActiveVersionId(sourceAgent.id, "IDENTITY.md");
    const identityAfterRollback =
      agentFiles.get(buildPromptKey(sourceAgent.id, "IDENTITY.md")) ?? "";
    const rollbackPassed =
      activeVersionAfterRollback !== null &&
      activeVersionAfterRollback !== activeVersionBeforeRollback &&
      identityAfterRollback === contentBeforeRollbackApply;
    recordResult(
      results,
      "验证效果-回滚",
      Boolean(rollbackPassed),
      rollbackPassed ? "错误率恶化后已自动回滚到应用前版本" : "未按预期回滚到应用前版本",
    );

    const pendingDispatch = useExperienceStore
      .getState()
      .teachingDispatches.find(
        (dispatch) =>
          dispatch.sourceAgentId === sourceAgent.id && dispatch.targetAgentId === targetAgent.id,
      );
    if (!pendingDispatch && verifiedEntry?.status === "verified") {
      useExperienceStore.getState().enqueueTeaching([
        {
          id: crypto.randomUUID(),
          experienceId: verifiedEntry.id,
          sourceAgentId: sourceAgent.id,
          targetAgentId: targetAgent.id,
          suggestion: verifiedEntry.suggestion,
          scheduledAt: fakeNow,
          createdAt: fakeNow,
          status: "pending",
        },
      ]);
    }

    queueReply(targetAgent.id, buildPeerTeachReply());
    await useGrowthStore.getState().processTeachingQueue({
      force: true,
      agentId: sourceAgent.id,
    });

    const targetMessages = useChatStore.getState().getMessagesForAgent(targetAgent.id);
    const propagationPassed = targetMessages.some(
      (message) =>
        message.role === "user" &&
        message.content.includes("【系统成长任务 / 同事带教】") &&
        message.content.includes("把错误排查清单写进 IDENTITY.md"),
    );
    recordResult(
      results,
      "经验传播",
      propagationPassed,
      propagationPassed ? "目标员工已收到经验推荐消息" : "目标员工未收到经验推荐消息",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    recordResult(results, "测试执行异常", false, detail);
  } finally {
    gateway.sendChat = originalSendChat;
    gateway.loadHistory = originalLoadHistory;
    gateway.getAgentFile = originalGetAgentFile;
    gateway.saveAgentFile = originalSaveAgentFile;
    Date.now = originalDateNow;
    restoreStoreSnapshots(snapshots);
    growthTestsRunning = false;
  }

  const failedItems = results.filter((item) => !item.pass).map((item) => item.name);
  const summary = {
    passed: results.filter((item) => item.pass).length,
    failed: failedItems.length,
    failedItems,
    results,
  } satisfies GrowthTestSummary;

  log("====== 测试结果汇总 ======");
  log(`通过：${summary.passed}/9`);
  log(`失败：${summary.failed}/9`);
  log(`失败项：${summary.failedItems.length > 0 ? summary.failedItems.join("、") : "无"}`);

  return summary;
}
