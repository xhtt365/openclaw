import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { gateway } from "@/services/gateway";
import { useAchievementStore } from "@/stores/achievementStore";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useExperienceStore } from "@/stores/experienceStore";
import { useHealthStore } from "@/stores/healthStore";
import { usePromptVersionStore } from "@/stores/promptVersionStore";
import { useStatsStore } from "@/stores/statsStore";
import type {
  GrowthEvent,
  GrowthReviewRecord,
  MetricSnapshot,
  RankingEntry,
  RankingSnapshot,
  WeeklyGrowthSnapshot,
} from "@/types/growth";
import { getDefaultCronTimezone, type CronScheduleDraft } from "@/utils/cronTask";
import {
  appendGrowthInstructionToIdentity,
  buildLeaderboard,
  buildPeerTeachPrompt,
  buildWeeklyReviewPrompt,
  collectMetricSnapshot,
  collectRollingMetricSnapshot,
  compareMetricSnapshots,
  createWeekKey,
  createWeekLabel,
  createWeeklyWindow,
  extractSuggestionFromReport,
  formatGrowthDeltaBadge,
  mapLeaderboardByAgentId,
  resolveLevelBadge,
  resolveReviewSourceLabel,
  summarizeConversation,
} from "@/utils/growth";
import { adaptHistoryMessages } from "@/utils/messageAdapter";
import { createSafeStorageAdapter } from "@/utils/storage";

const GROWTH_STORAGE_KEY = "xiaban.growth.v1";
const SCHEDULER_TICK_MS = 60_000;
const MAX_REVIEWS = 160;
const MAX_SNAPSHOTS = 160;
const MAX_EVENTS = 160;

type GrowthState = {
  initialized: boolean;
  reviewSchedule: CronScheduleDraft;
  reviews: GrowthReviewRecord[];
  weeklySnapshots: WeeklyGrowthSnapshot[];
  events: GrowthEvent[];
  lastScheduledReviewSlotByAgentId: Record<string, string>;
  initialize: () => void;
  runWeeklyReviews: (options?: {
    agentId?: string;
    force?: boolean;
    trigger?: "cron" | "manual";
  }) => Promise<GrowthReviewRecord[]>;
  applyReviewSuggestion: (reviewId: string) => Promise<void>;
  evaluatePendingChanges: (options?: { force?: boolean; agentId?: string }) => Promise<void>;
  processTeachingQueue: (options?: { force?: boolean; agentId?: string }) => Promise<void>;
  getReviewsForAgent: (agentId: string) => GrowthReviewRecord[];
  getSnapshotsForAgent: (agentId: string) => WeeklyGrowthSnapshot[];
  getLatestSnapshotForAgent: (agentId: string) => WeeklyGrowthSnapshot | null;
};

type PersistedGrowthState = Pick<
  GrowthState,
  "reviewSchedule" | "reviews" | "weeklySnapshots" | "events" | "lastScheduledReviewSlotByAgentId"
>;

function resolveGrowthStorage() {
  return createSafeStorageAdapter();
}

function createDefaultReviewSchedule(): CronScheduleDraft {
  return {
    mode: "weekly",
    time: "18:00",
    weekday: "5",
    intervalHours: 24,
    expr: "0 18 * * 5",
    timezone: getDefaultCronTimezone(),
  };
}

function withEventLimit(events: GrowthEvent[]) {
  return events.toSorted((left, right) => right.time - left.time).slice(0, MAX_EVENTS);
}

function withReviewLimit(reviews: GrowthReviewRecord[]) {
  return reviews.toSorted((left, right) => right.createdAt - left.createdAt).slice(0, MAX_REVIEWS);
}

function withSnapshotLimit(snapshots: WeeklyGrowthSnapshot[]) {
  return snapshots
    .toSorted((left, right) => right.capturedAt - left.capturedAt)
    .slice(0, MAX_SNAPSHOTS);
}

function upsertWeeklySnapshot(
  snapshots: WeeklyGrowthSnapshot[],
  nextSnapshot: WeeklyGrowthSnapshot,
) {
  const exists = snapshots.some(
    (snapshot) =>
      snapshot.agentId === nextSnapshot.agentId && snapshot.weekKey === nextSnapshot.weekKey,
  );

  return withSnapshotLimit(
    exists
      ? snapshots.map((snapshot) =>
          snapshot.agentId === nextSnapshot.agentId && snapshot.weekKey === nextSnapshot.weekKey
            ? nextSnapshot
            : snapshot,
        )
      : [nextSnapshot, ...snapshots],
  );
}

function buildEvent(params: Omit<GrowthEvent, "id">): GrowthEvent {
  return {
    id: crypto.randomUUID(),
    ...params,
  };
}

function resolveCurrentReviewSlot(schedule: CronScheduleDraft, now = Date.now()) {
  if (schedule.mode !== "weekly") {
    return null;
  }

  const [hourText = "18", minuteText = "00"] = schedule.time.split(":");
  const scheduledHour = Number(hourText) || 18;
  const scheduledMinute = Number(minuteText) || 0;
  const weekday = Number(schedule.weekday);

  const weekWindow = createWeeklyWindow(now);
  const weekStart = weekWindow.startAt;
  const targetOffset = weekday === 0 ? 6 : weekday - 1;
  const scheduledAt = weekStart + targetOffset * 24 * 60 * 60 * 1000;
  const scheduledDate = new Date(scheduledAt);
  scheduledDate.setHours(scheduledHour, scheduledMinute, 0, 0);
  const scheduledTimestamp = scheduledDate.getTime();

  if (now < scheduledTimestamp) {
    return null;
  }

  return {
    slotKey: `${weekWindow.weekKey}:${schedule.weekday}:${schedule.time}`,
    weekKey: weekWindow.weekKey,
    weekLabel: weekWindow.weekLabel,
    scheduledAt: scheduledTimestamp,
  };
}

function resolvePreviousSnapshotMap(
  snapshots: WeeklyGrowthSnapshot[],
  currentWeekKey: string,
): Record<string, { metrics: MetricSnapshot; score: number } | null> {
  const next: Record<string, { metrics: MetricSnapshot; score: number } | null> = {};
  const grouped = new Map<string, WeeklyGrowthSnapshot[]>();

  for (const snapshot of snapshots) {
    const current = grouped.get(snapshot.agentId) ?? [];
    grouped.set(snapshot.agentId, [...current, snapshot]);
  }

  for (const [agentId, items] of grouped.entries()) {
    const latest = items
      .filter((item) => item.weekKey !== currentWeekKey)
      .toSorted((left, right) => right.capturedAt - left.capturedAt)
      .at(0);

    next[agentId] = latest ? { metrics: latest.metrics, score: latest.score } : null;
  }

  return next;
}

function getReviewSource(review: GrowthReviewRecord) {
  return review.kind === "peer_teach" ? "peer_teach" : "self_review";
}

function resolveAgentName(agentId: string) {
  return (
    useAgentStore
      .getState()
      .agents.find((agent) => agent.id === agentId)
      ?.name?.trim() || agentId
  );
}

function buildRollingBeforeSnapshot(agentId: string, endAt = Date.now()) {
  return collectRollingMetricSnapshot({
    agentId,
    hourlyStatsByKey: useStatsStore.getState().hourlyStatsByKey,
    healthRecord: useHealthStore.getState().recordsByAgentId[agentId],
    endAt,
    durationDays: 7,
    label: "应用前 7 日",
  });
}

function buildRollingAfterSnapshot(agentId: string, startAt: number, endAt: number) {
  return collectMetricSnapshot({
    agentId,
    hourlyStatsByKey: useStatsStore.getState().hourlyStatsByKey,
    healthRecord: useHealthStore.getState().recordsByAgentId[agentId],
    startAt,
    endAt,
    label: "应用后 7 日",
  });
}

function buildCurrentRankingEntries() {
  const currentWeekKey = createWeekKey(Date.now());
  const previousSnapshots = resolvePreviousSnapshotMap(
    useGrowthStore.getState().weeklySnapshots,
    currentWeekKey,
  );

  return buildLeaderboard({
    agents: useAgentStore.getState().agents,
    hourlyStatsByKey: useStatsStore.getState().hourlyStatsByKey,
    healthRecordsByAgentId: useHealthStore.getState().recordsByAgentId,
    previousSnapshotsByAgentId: previousSnapshots,
  });
}

function findLatestReviewMessageReply(agentId: string, createdAt: number) {
  return (
    useChatStore
      .getState()
      .getMessagesForAgent(agentId)
      .toReversed()
      .find(
        (message) =>
          message.role === "assistant" &&
          typeof message.timestamp === "number" &&
          message.timestamp >= createdAt,
      ) ?? null
  );
}

function resolveExperienceTeachAt(now = Date.now()) {
  const date = new Date(now);
  date.setSeconds(0, 0);
  if (date.getHours() < 9) {
    date.setHours(9, 0, 0, 0);
    return date.getTime();
  }

  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

function buildWeeklySnapshot(params: {
  agentId: string;
  weekKey: string;
  weekLabel: string;
  ranking: RankingEntry | null;
  previousSnapshot: WeeklyGrowthSnapshot | null;
}) {
  const ranking = params.ranking;
  const metrics =
    ranking?.metrics ??
    collectMetricSnapshot({
      agentId: params.agentId,
      hourlyStatsByKey: useStatsStore.getState().hourlyStatsByKey,
      healthRecord: useHealthStore.getState().recordsByAgentId[params.agentId],
      startAt: createWeeklyWindow().startAt,
      endAt: Date.now(),
      label: "本周",
    });
  const score = ranking?.score ?? 50;
  const growthDelta =
    ranking?.growthDelta ??
    (params.previousSnapshot
      ? compareMetricSnapshots(params.previousSnapshot.metrics, metrics).scoreDelta
      : null);

  return {
    id: crypto.randomUUID(),
    agentId: params.agentId,
    weekKey: params.weekKey,
    weekLabel: params.weekLabel,
    capturedAt: Date.now(),
    metrics,
    score,
    rank: ranking?.rank ?? null,
    scoreDelta: ranking?.scoreDelta ?? null,
    growthDelta,
    level:
      ranking?.level ??
      (score >= 90 ? "expert" : score >= 75 ? "elite" : score >= 60 ? "skilled" : "newbie"),
  } satisfies WeeklyGrowthSnapshot;
}

async function loadConversationSummary(agentId: string) {
  const mainKey = useAgentStore.getState().mainKey?.trim();
  if (!mainKey) {
    return "- 当前还没有可回看的典型对话";
  }

  const history = await gateway.loadHistory(`agent:${agentId}:${mainKey}`, 16);
  return summarizeConversation(adaptHistoryMessages(history));
}

function createRankingSnapshot(items: RankingEntry[]): RankingSnapshot {
  return {
    id: crypto.randomUUID(),
    weekKey: createWeekKey(Date.now()),
    createdAt: Date.now(),
    items,
  };
}

function buildMonthlyKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function countVerifiedExperienceForAgent(agentId: string) {
  return useExperienceStore
    .getState()
    .entries.filter((entry) => entry.source === agentId && entry.status === "verified").length;
}

function countMentoredTargetsForAgent(agentId: string) {
  const entries = useExperienceStore
    .getState()
    .entries.filter((entry) => entry.status === "verified");
  const baseEntries = new Map(
    useExperienceStore.getState().entries.map((entry) => [entry.id, entry] as const),
  );
  const targetSet = new Set<string>();

  for (const entry of entries) {
    if (!entry.basedOnExperienceId) {
      continue;
    }

    const baseEntry = baseEntries.get(entry.basedOnExperienceId);
    if (baseEntry?.source !== agentId) {
      continue;
    }

    targetSet.add(entry.source);
  }

  return targetSet.size;
}

function getRecentHealthLatencies(agentId: string) {
  return (
    useHealthStore
      .getState()
      .recordsByAgentId[agentId]?.interactions.filter(
        (interaction) => interaction.success && typeof interaction.latencyMs === "number",
      )
      .slice(-8)
      .map((interaction) => interaction.latencyMs ?? 0) ?? []
  );
}

function maybeUnlockAchievement(params: {
  agentId: string;
  achievementId: Parameters<
    ReturnType<typeof useAchievementStore.getState>["unlockAchievement"]
  >[0]["achievementId"];
  detail: string;
  pushEvent: (event: GrowthEvent) => void;
}) {
  const unlocked = useAchievementStore.getState().unlockAchievement({
    id: crypto.randomUUID(),
    agentId: params.agentId,
    achievementId: params.achievementId,
    unlockedAt: Date.now(),
    detail: params.detail,
  });

  if (!unlocked) {
    return;
  }

  const definition = useAchievementStore
    .getState()
    .definitions.find((item) => item.id === params.achievementId);
  const agentName = resolveAgentName(params.agentId);
  params.pushEvent(
    buildEvent({
      time: Date.now(),
      tone: "done",
      title: "achievement-unlocked",
      agentId: params.agentId,
      agentName,
      text: `🎖️ ${agentName} 解锁成就「${definition?.icon ?? ""} ${definition?.name ?? params.achievementId}」`,
    }),
  );
}

export const useGrowthStore = create<GrowthState>()(
  persist(
    (set, get) => {
      let schedulerTimer: number | null = null;
      let reviewRunning = false;
      let validationRunning = false;
      let teachingRunning = false;

      function pushEvent(event: GrowthEvent) {
        set((state) => ({
          events: withEventLimit([event, ...state.events]),
        }));
      }

      async function runScheduledTasks() {
        const slot = resolveCurrentReviewSlot(get().reviewSchedule);
        if (slot && !reviewRunning) {
          const agents = useAgentStore.getState().agents;
          const shouldRun = agents.some(
            (agent) => get().lastScheduledReviewSlotByAgentId[agent.id] !== slot.slotKey,
          );
          if (shouldRun) {
            await get().runWeeklyReviews({ force: false, trigger: "cron" });
          }
        }

        if (!validationRunning) {
          await get().evaluatePendingChanges();
        }

        if (!teachingRunning) {
          await get().processTeachingQueue();
        }
      }

      return {
        initialized: false,
        reviewSchedule: createDefaultReviewSchedule(),
        reviews: [],
        weeklySnapshots: [],
        events: [],
        lastScheduledReviewSlotByAgentId: {},

        initialize: () => {
          if (get().initialized) {
            return;
          }

          console.log("[Growth] initialize growth store");
          set({ initialized: true });

          if (schedulerTimer !== null) {
            window.clearInterval(schedulerTimer);
          }

          schedulerTimer = window.setInterval(() => {
            void runScheduledTasks();
          }, SCHEDULER_TICK_MS);

          void runScheduledTasks();
        },

        runWeeklyReviews: async (options = {}) => {
          if (reviewRunning) {
            return [];
          }

          reviewRunning = true;
          try {
            const allAgents = useAgentStore.getState().agents;
            const targetAgents = allAgents.filter((agent) =>
              !options.agentId ? true : agent.id === options.agentId,
            );
            if (targetAgents.length === 0) {
              return [];
            }

            const weekWindow = createWeeklyWindow();
            const previousSnapshotsByAgentId = resolvePreviousSnapshotMap(
              get().weeklySnapshots,
              weekWindow.weekKey,
            );
            const rankingEntries = buildLeaderboard({
              agents: allAgents,
              hourlyStatsByKey: useStatsStore.getState().hourlyStatsByKey,
              healthRecordsByAgentId: useHealthStore.getState().recordsByAgentId,
              previousSnapshotsByAgentId,
            });
            const rankingMap = mapLeaderboardByAgentId(rankingEntries);
            useAchievementStore
              .getState()
              .upsertRankingSnapshot(createRankingSnapshot(rankingEntries));

            const createdReviews: GrowthReviewRecord[] = [];
            const scheduledSlot = resolveCurrentReviewSlot(get().reviewSchedule);

            for (const agent of targetAgents) {
              if (!options.force) {
                const existing = get().reviews.find(
                  (review) =>
                    review.agentId === agent.id &&
                    review.kind === "weekly_review" &&
                    review.weekKey === weekWindow.weekKey,
                );
                if (existing) {
                  continue;
                }
              }

              const previousSnapshot =
                get()
                  .weeklySnapshots.filter(
                    (snapshot) =>
                      snapshot.agentId === agent.id && snapshot.weekKey !== weekWindow.weekKey,
                  )
                  .toSorted((left, right) => right.capturedAt - left.capturedAt)
                  .at(0) ?? null;
              const snapshot = buildWeeklySnapshot({
                agentId: agent.id,
                weekKey: weekWindow.weekKey,
                weekLabel: weekWindow.weekLabel,
                ranking: rankingMap[agent.id] ?? null,
                previousSnapshot,
              });
              const conversationSummary = await loadConversationSummary(agent.id);
              const prompt = buildWeeklyReviewPrompt({
                agentName: agent.name,
                snapshot: snapshot.metrics,
                previousSnapshot: previousSnapshotsByAgentId[agent.id],
                ranking: rankingMap[agent.id] ?? null,
                conversationSummary,
              });

              console.log(
                `[Growth] 触发周度自评: agent=${agent.id}, trigger=${options.trigger ?? "cron"}`,
              );
              const createdAt = Date.now();
              const immediateReply = await useChatStore
                .getState()
                .sendProgrammaticMessageToAgent(agent.id, prompt);
              const reply = immediateReply ?? findLatestReviewMessageReply(agent.id, createdAt);
              if (!reply?.content.trim()) {
                continue;
              }

              const review: GrowthReviewRecord = {
                id: crypto.randomUUID(),
                agentId: agent.id,
                kind: "weekly_review",
                trigger: options.trigger ?? "cron",
                weekKey: weekWindow.weekKey,
                createdAt,
                prompt,
                report: reply.content.trim(),
                suggestion: extractSuggestionFromReport(reply.content),
                snapshot,
                previousSnapshot,
                status: "pending_approval",
              };
              createdReviews.push(review);

              pushEvent(
                buildEvent({
                  time: createdAt,
                  tone: "done",
                  title: "weekly-review",
                  agentId: agent.id,
                  agentName: agent.name,
                  text: `📝 ${agent.name} 完成周度自评，综合评分 ${snapshot.score}（${formatGrowthDeltaBadge(snapshot.growthDelta)}）${rankingMap[agent.id]?.fastestImprover ? " 🔥 进步最快" : ""}`,
                }),
              );

              set((state) => ({
                reviews: withReviewLimit([review, ...state.reviews]),
                weeklySnapshots: upsertWeeklySnapshot(state.weeklySnapshots, snapshot),
                lastScheduledReviewSlotByAgentId:
                  scheduledSlot && (options.trigger ?? "cron") === "cron"
                    ? {
                        ...state.lastScheduledReviewSlotByAgentId,
                        [agent.id]: scheduledSlot.slotKey,
                      }
                    : state.lastScheduledReviewSlotByAgentId,
              }));
            }

            const latestRankingSnapshot = useAchievementStore.getState().getLatestRankingSnapshot();
            const rankingItems = latestRankingSnapshot?.items ?? [];
            const topTokenAgentId = rankingItems
              .filter((item) => item.metrics.turnCount >= 20)
              .toSorted(
                (left, right) =>
                  (right.metrics.tokenEfficiency ?? 0) - (left.metrics.tokenEfficiency ?? 0),
              )[0]?.agentId;
            const monthlySnapshots = [
              ...(useAchievementStore.getState().rankingSnapshots ?? []),
              latestRankingSnapshot,
            ]
              .filter((item): item is RankingSnapshot => item !== null)
              .filter(
                (snapshot) => buildMonthlyKey(snapshot.createdAt) === buildMonthlyKey(Date.now()),
              );

            for (const item of rankingItems) {
              const latencies = getRecentHealthLatencies(item.agentId);
              if (latencies.length >= 8 && latencies.every((latency) => latency < 1000)) {
                maybeUnlockAchievement({
                  agentId: item.agentId,
                  achievementId: "flash_reply",
                  detail: "连续 8 次响应快于 1 秒。",
                  pushEvent,
                });
              }

              if (item.metrics.errorCount === 0 && item.metrics.turnCount >= 10) {
                maybeUnlockAchievement({
                  agentId: item.agentId,
                  achievementId: "zero_error_week",
                  detail: "本周零错误且完成至少 10 轮对话。",
                  pushEvent,
                });
              }

              if ((item.scoreDelta ?? 0) >= 12) {
                maybeUnlockAchievement({
                  agentId: item.agentId,
                  achievementId: "rapid_growth",
                  detail: `综合分提升 ${item.scoreDelta} 分。`,
                  pushEvent,
                });
              }

              if (item.agentId === topTokenAgentId) {
                maybeUnlockAchievement({
                  agentId: item.agentId,
                  achievementId: "token_saver",
                  detail: "本周 Token 效率全队第一。",
                  pushEvent,
                });
              }

              const bestMonthlyTop = monthlySnapshots
                .flatMap((snapshot) => snapshot.items.filter((entry) => entry.rank === 1))
                .toSorted((left, right) => right.score - left.score)[0];
              if (item.rank === 1 && bestMonthlyTop?.agentId === item.agentId) {
                maybeUnlockAchievement({
                  agentId: item.agentId,
                  achievementId: "monthly_mvp",
                  detail: "当前月份综合分最高。",
                  pushEvent,
                });
              }
            }

            const recentTopAgents = useAchievementStore
              .getState()
              .rankingSnapshots.slice(0, 3)
              .map((snapshot) => snapshot.items.find((item) => item.rank === 1)?.agentId)
              .filter(Boolean);
            if (
              recentTopAgents.length === 3 &&
              recentTopAgents.every((agentId) => agentId === recentTopAgents[0])
            ) {
              maybeUnlockAchievement({
                agentId: recentTopAgents[0]!,
                achievementId: "streak_king",
                detail: "连续 3 周综合排名第一。",
                pushEvent,
              });
            }

            return createdReviews;
          } finally {
            reviewRunning = false;
          }
        },

        applyReviewSuggestion: async (reviewId) => {
          const review = get().reviews.find((item) => item.id === reviewId);
          if (!review || review.status !== "pending_approval") {
            return;
          }

          const previousContent = await gateway.getAgentFile(review.agentId, "IDENTITY.md");
          const nextContent = appendGrowthInstructionToIdentity({
            content: previousContent,
            suggestion: review.suggestion,
            sourceLabel: resolveReviewSourceLabel(review.kind),
          });
          const beforeSnapshot = buildRollingBeforeSnapshot(review.agentId);
          const version = await usePromptVersionStore.getState().saveVersionedPrompt({
            agentId: review.agentId,
            fileName: "IDENTITY.md",
            previousContent,
            nextContent,
            changeDescription:
              review.kind === "peer_teach" ? "应用同事带教建议" : "应用周度自评建议",
            source: getReviewSource(review),
            metrics: beforeSnapshot,
          });

          const now = Date.now();
          const experienceId = review.experienceId ?? crypto.randomUUID();
          useExperienceStore.getState().upsertEntry({
            id: experienceId,
            source: review.agentId,
            sourceReviewId: review.id,
            basedOnExperienceId: review.sourceExperienceId,
            weekKey: review.weekKey,
            suggestion: review.suggestion,
            appliedTo: [],
            status: "pending",
            createdAt: now,
            evaluationDueAt: now + 7 * 24 * 60 * 60 * 1000,
            metrics: {
              before: beforeSnapshot,
            },
          });

          set((state) => ({
            reviews: state.reviews.map((item) =>
              item.id === reviewId
                ? {
                    ...item,
                    status: "applied",
                    appliedAt: now,
                    promptVersionId: version?.id,
                    experienceId,
                  }
                : item,
            ),
          }));

          const agentName = resolveAgentName(review.agentId);
          pushEvent(
            buildEvent({
              time: now,
              tone: "executing",
              title: "suggestion-applied",
              agentId: review.agentId,
              agentName,
              text: `🧩 ${agentName} 的建议已写入 IDENTITY.md，当前等级 ${resolveLevelBadge(review.snapshot.level)}`,
            }),
          );

          const relatedDispatch = useExperienceStore
            .getState()
            .teachingDispatches.find((dispatch) => dispatch.relatedReviewId === review.id);
          if (relatedDispatch) {
            useExperienceStore
              .getState()
              .updateTeachingDispatch(relatedDispatch.id, (dispatch) => ({
                ...dispatch,
                status: "applied",
              }));
          }
        },

        evaluatePendingChanges: async (options = {}) => {
          if (validationRunning) {
            return;
          }

          validationRunning = true;
          try {
            const now = Date.now();
            const pendingEntries = useExperienceStore.getState().entries.filter((entry) => {
              if (entry.status !== "pending") {
                return false;
              }

              if (options.agentId && entry.source !== options.agentId) {
                return false;
              }

              return options.force ? true : entry.evaluationDueAt <= now;
            });

            for (const entry of pendingEntries) {
              const afterEndAt = options.force ? now : entry.evaluationDueAt;
              const afterSnapshot = buildRollingAfterSnapshot(
                entry.source,
                entry.createdAt,
                Math.max(afterEndAt, entry.createdAt + 60_000),
              );
              const comparison = compareMetricSnapshots(entry.metrics.before, afterSnapshot);
              const review = get().reviews.find((item) => item.experienceId === entry.id) ?? null;
              const agentName = resolveAgentName(entry.source);

              if (comparison.status === "improved") {
                console.log(`[Experience] 经验验证通过: entry=${entry.id}`);
                useExperienceStore.getState().updateEntry(entry.id, (current) => ({
                  ...current,
                  status: "verified",
                  metrics: {
                    ...current.metrics,
                    after: afterSnapshot,
                  },
                }));
                if (review) {
                  set((state) => ({
                    reviews: state.reviews.map((item) =>
                      item.id === review.id
                        ? {
                            ...item,
                            status: "verified",
                            verifiedAt: now,
                          }
                        : item,
                    ),
                  }));
                }

                pushEvent(
                  buildEvent({
                    time: now,
                    tone: "done",
                    title: "experience-verified",
                    agentId: entry.source,
                    agentName,
                    text: `✅ ${agentName} 的经验 ${entry.id.slice(0, 5)} 验证通过，已加入经验库`,
                  }),
                );

                const rankingEntries = buildCurrentRankingEntries();
                const sourceRanking =
                  rankingEntries.find((item) => item.agentId === entry.source) ?? null;
                const targets = rankingEntries
                  .filter((item) => item.agentId !== entry.source)
                  .filter((item) => (sourceRanking ? item.rank > sourceRanking.rank : true))
                  .map((item) => item.agentId);
                const finalTargets =
                  targets.length > 0
                    ? targets
                    : useAgentStore
                        .getState()
                        .agents.filter((agent) => agent.id !== entry.source)
                        .map((agent) => agent.id);

                useExperienceStore.getState().enqueueTeaching(
                  finalTargets.map((targetAgentId) => ({
                    id: crypto.randomUUID(),
                    experienceId: entry.id,
                    sourceAgentId: entry.source,
                    targetAgentId,
                    suggestion: entry.suggestion,
                    scheduledAt: resolveExperienceTeachAt(now),
                    createdAt: now,
                    status: "pending",
                  })),
                );

                if (countVerifiedExperienceForAgent(entry.source) >= 2) {
                  maybeUnlockAchievement({
                    agentId: entry.source,
                    achievementId: "experience_contributor",
                    detail: "已贡献至少 2 条验证有效经验。",
                    pushEvent,
                  });
                }

                if (entry.basedOnExperienceId) {
                  const parentEntry = useExperienceStore
                    .getState()
                    .entries.find((item) => item.id === entry.basedOnExperienceId);
                  if (parentEntry && countMentoredTargetsForAgent(parentEntry.source) >= 2) {
                    maybeUnlockAchievement({
                      agentId: parentEntry.source,
                      achievementId: "mentor_friend",
                      detail: "带教至少 2 位同事完成提升。",
                      pushEvent,
                    });
                  }
                }
                continue;
              }

              if (comparison.status === "degraded" && review?.promptVersionId) {
                const promptVersionId = review.promptVersionId;
                const version = usePromptVersionStore
                  .getState()
                  .versions.find((item) => item.id === promptVersionId);
                const fileName = version?.fileName ?? "IDENTITY.md";
                const versionsForAgent = usePromptVersionStore
                  .getState()
                  .getVersionsForAgent(entry.source)
                  .filter((item) => item.fileName === fileName);
                const activeVersionId = usePromptVersionStore
                  .getState()
                  .getActiveVersionId(entry.source, fileName);
                const activeIndex = versionsForAgent.findIndex(
                  (item) => item.id === activeVersionId,
                );
                const fallbackVersion = activeIndex >= 0 ? versionsForAgent[activeIndex + 1] : null;

                if (fallbackVersion) {
                  await usePromptVersionStore.getState().rollbackToVersion({
                    agentId: entry.source,
                    fileName,
                    versionId: fallbackVersion.id,
                    reason: `自动回滚：${comparison.summary}`,
                    metrics: afterSnapshot,
                  });
                }

                useExperienceStore.getState().updateEntry(entry.id, (current) => ({
                  ...current,
                  status: "rolled_back",
                  metrics: {
                    ...current.metrics,
                    after: afterSnapshot,
                  },
                }));
                set((state) => ({
                  reviews: state.reviews.map((item) =>
                    item.id === review.id
                      ? {
                          ...item,
                          status: "rolled_back",
                          rolledBackAt: now,
                        }
                      : item,
                  ),
                }));

                const errorRateDeltaText =
                  comparison.errorRateChangePct !== null
                    ? `${Math.round(Math.abs(comparison.errorRateChangePct) * 100)}%`
                    : "明显";
                pushEvent(
                  buildEvent({
                    time: now,
                    tone: "error",
                    title: "prompt-rollback",
                    agentId: entry.source,
                    agentName,
                    text: `⚠️ ${agentName} 的提示词导致错误率上升 ${errorRateDeltaText}，已自动回滚`,
                  }),
                );
                continue;
              }

              useExperienceStore.getState().updateEntry(entry.id, (current) => ({
                ...current,
                status: "failed",
                metrics: {
                  ...current.metrics,
                  after: afterSnapshot,
                },
              }));
              if (review) {
                set((state) => ({
                  reviews: state.reviews.map((item) =>
                    item.id === review.id
                      ? {
                          ...item,
                          status: "failed",
                        }
                      : item,
                  ),
                }));
              }
            }
          } finally {
            validationRunning = false;
          }
        },

        processTeachingQueue: async (options = {}) => {
          if (teachingRunning) {
            return;
          }

          teachingRunning = true;
          try {
            const now = Date.now();
            const pendingDispatches = useExperienceStore
              .getState()
              .teachingDispatches.filter((dispatch) => {
                if (dispatch.status !== "pending") {
                  return false;
                }

                if (options.agentId && dispatch.sourceAgentId !== options.agentId) {
                  return false;
                }

                return options.force ? true : dispatch.scheduledAt <= now;
              });

            const pushedSummary = new Map<string, string[]>();

            for (const dispatch of pendingDispatches) {
              const entry = useExperienceStore
                .getState()
                .entries.find((item) => item.id === dispatch.experienceId);
              if (!entry || entry.status !== "verified") {
                useExperienceStore.getState().updateTeachingDispatch(dispatch.id, (current) => ({
                  ...current,
                  status: "skipped",
                }));
                continue;
              }

              const comparison = compareMetricSnapshots(
                entry.metrics.before,
                entry.metrics.after ?? entry.metrics.before,
              );
              const prompt = buildPeerTeachPrompt({
                sourceAgentName: resolveAgentName(dispatch.sourceAgentId),
                suggestion: dispatch.suggestion,
                comparison,
              });
              const createdAt = Date.now();
              const immediateReply = await useChatStore
                .getState()
                .sendProgrammaticMessageToAgent(dispatch.targetAgentId, prompt);
              const reply =
                immediateReply ?? findLatestReviewMessageReply(dispatch.targetAgentId, createdAt);
              if (!reply?.content.trim()) {
                continue;
              }

              const rankingEntry =
                buildCurrentRankingEntries().find(
                  (item) => item.agentId === dispatch.targetAgentId,
                ) ?? null;
              const previousSnapshot =
                get()
                  .weeklySnapshots.filter((snapshot) => snapshot.agentId === dispatch.targetAgentId)
                  .toSorted((left, right) => right.capturedAt - left.capturedAt)
                  .at(0) ?? null;
              const weekKey = createWeekKey(createdAt);
              const review: GrowthReviewRecord = {
                id: crypto.randomUUID(),
                agentId: dispatch.targetAgentId,
                kind: "peer_teach",
                trigger: "peer_teach",
                weekKey,
                createdAt,
                prompt,
                report: reply.content.trim(),
                suggestion: extractSuggestionFromReport(reply.content),
                snapshot: buildWeeklySnapshot({
                  agentId: dispatch.targetAgentId,
                  weekKey,
                  weekLabel: createWeekLabel(createdAt),
                  ranking: rankingEntry,
                  previousSnapshot,
                }),
                previousSnapshot,
                status: "pending_approval",
                sourceAgentId: dispatch.sourceAgentId,
                sourceExperienceId: dispatch.experienceId,
              };

              set((state) => ({
                reviews: withReviewLimit([review, ...state.reviews]),
                weeklySnapshots: upsertWeeklySnapshot(state.weeklySnapshots, review.snapshot),
              }));
              useExperienceStore.getState().updateTeachingDispatch(dispatch.id, (current) => ({
                ...current,
                status: "sent",
                deliveredAt: createdAt,
                relatedReviewId: review.id,
              }));
              useExperienceStore.getState().updateEntry(entry.id, (current) => ({
                ...current,
                appliedTo: Array.from(new Set([...current.appliedTo, dispatch.targetAgentId])),
              }));

              const currentTargets = pushedSummary.get(entry.id) ?? [];
              pushedSummary.set(entry.id, [
                ...currentTargets,
                resolveAgentName(dispatch.targetAgentId),
              ]);
            }

            for (const [experienceId, targetNames] of pushedSummary.entries()) {
              if (targetNames.length === 0) {
                continue;
              }

              pushEvent(
                buildEvent({
                  time: Date.now(),
                  tone: "system",
                  title: "teaching-pushed",
                  text: `📤 经验 ${experienceId.slice(0, 5)} 已推送给 ${targetNames.join("、")}`,
                }),
              );
            }
          } finally {
            teachingRunning = false;
          }
        },

        getReviewsForAgent: (agentId) => {
          return get()
            .reviews.filter((review) => review.agentId === agentId)
            .toSorted((left, right) => right.createdAt - left.createdAt);
        },

        getSnapshotsForAgent: (agentId) => {
          return get()
            .weeklySnapshots.filter((snapshot) => snapshot.agentId === agentId)
            .toSorted((left, right) => left.capturedAt - right.capturedAt);
        },

        getLatestSnapshotForAgent: (agentId) => {
          return (
            get()
              .weeklySnapshots.filter((snapshot) => snapshot.agentId === agentId)
              .toSorted((left, right) => right.capturedAt - left.capturedAt)
              .at(0) ?? null
          );
        },
      };
    },
    {
      name: GROWTH_STORAGE_KEY,
      storage: createJSONStorage(resolveGrowthStorage),
      partialize: (state): PersistedGrowthState => ({
        reviewSchedule: state.reviewSchedule,
        reviews: state.reviews,
        weeklySnapshots: state.weeklySnapshots,
        events: state.events,
        lastScheduledReviewSlotByAgentId: state.lastScheduledReviewSlotByAgentId,
      }),
    },
  ),
);
