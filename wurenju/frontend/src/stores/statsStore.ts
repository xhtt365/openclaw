import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentHealthRecord } from "@/utils/health";
import {
  applyInteractionToHourlyStats,
  createHourlyStatsKey,
  getHourlyStatsEntries,
  pruneHourlyStatsByKey,
  resolveHourlyBucket,
  STATS_RETENTION_MS,
  type HourlyStats,
} from "@/utils/stats";
import { createSafeStorageAdapter } from "@/utils/storage";

const STATS_STORAGE_KEY = "xiaban.stats.v1";
const MAX_CURSOR_IDS = 24;

type StatsSyncCursor = {
  lastCompletedAt: number;
  lastInteractionIds: string[];
};

interface StatsState {
  hourlyStatsByKey: Record<string, HourlyStats>;
  syncCursorByAgentId: Record<string, StatsSyncCursor>;

  initialize: (recordsByAgentId?: Record<string, AgentHealthRecord>) => void;
  syncAgentRecord: (agentId: string, record: AgentHealthRecord) => void;
}

type PersistedStatsState = Pick<StatsState, "hourlyStatsByKey" | "syncCursorByAgentId">;

function resolveStatsStorage() {
  return createSafeStorageAdapter();
}

function createEmptyCursor(): StatsSyncCursor {
  return {
    lastCompletedAt: 0,
    lastInteractionIds: [],
  };
}

function normalizeCursor(
  cursor: StatsSyncCursor | undefined,
  now = Date.now(),
): StatsSyncCursor | null {
  if (!cursor) {
    return null;
  }

  if (!Number.isFinite(cursor.lastCompletedAt) || cursor.lastCompletedAt <= 0) {
    return null;
  }

  return {
    lastCompletedAt: Math.min(cursor.lastCompletedAt, now),
    lastInteractionIds: Array.isArray(cursor.lastInteractionIds)
      ? cursor.lastInteractionIds
          .filter((item) => typeof item === "string" && item.trim())
          .slice(-MAX_CURSOR_IDS)
      : [],
  };
}

function pruneSyncCursors(syncCursorByAgentId: Record<string, StatsSyncCursor>, now = Date.now()) {
  const cutoff = now - STATS_RETENTION_MS;

  return Object.fromEntries(
    Object.entries(syncCursorByAgentId).flatMap(([agentId, cursor]) => {
      const normalizedCursor = normalizeCursor(cursor, now);
      if (!normalizedCursor) {
        return [];
      }

      if (normalizedCursor.lastCompletedAt < cutoff) {
        return [];
      }

      return [[agentId, normalizedCursor] satisfies [string, StatsSyncCursor]];
    }),
  );
}

function buildNextCursor(cursor: StatsSyncCursor, interactionId: string, completedAt: number) {
  if (completedAt > cursor.lastCompletedAt) {
    return {
      lastCompletedAt: completedAt,
      lastInteractionIds: [interactionId],
    } satisfies StatsSyncCursor;
  }

  if (
    completedAt === cursor.lastCompletedAt &&
    !cursor.lastInteractionIds.includes(interactionId)
  ) {
    return {
      lastCompletedAt: cursor.lastCompletedAt,
      lastInteractionIds: [...cursor.lastInteractionIds, interactionId].slice(-MAX_CURSOR_IDS),
    } satisfies StatsSyncCursor;
  }

  return cursor;
}

function shouldSkipInteraction(
  cursor: StatsSyncCursor,
  interactionId: string,
  completedAt: number,
) {
  if (completedAt < cursor.lastCompletedAt) {
    return true;
  }

  if (completedAt === cursor.lastCompletedAt && cursor.lastInteractionIds.includes(interactionId)) {
    return true;
  }

  return false;
}

export const useStatsStore = create<StatsState>()(
  persist(
    (set) => {
      let initialized = false;

      return {
        hourlyStatsByKey: {},
        syncCursorByAgentId: {},

        initialize: (recordsByAgentId = {}) => {
          if (!initialized) {
            initialized = true;
            console.log("[Stats] initialize");
          }

          set((state) => {
            const now = Date.now();
            const prunedHourlyStatsByKey = pruneHourlyStatsByKey(state.hourlyStatsByKey, now);
            const prunedSyncCursorByAgentId = pruneSyncCursors(state.syncCursorByAgentId, now);

            return {
              hourlyStatsByKey: prunedHourlyStatsByKey,
              syncCursorByAgentId: prunedSyncCursorByAgentId,
            };
          });

          for (const [agentId, record] of Object.entries(recordsByAgentId)) {
            useStatsStore.getState().syncAgentRecord(agentId, record);
          }
        },

        syncAgentRecord: (agentId, record) => {
          const normalizedAgentId = agentId.trim();
          if (!normalizedAgentId) {
            return;
          }

          set((state) => {
            const now = Date.now();
            const nextHourlyStatsByKey = {
              ...pruneHourlyStatsByKey(state.hourlyStatsByKey, now),
            };
            const nextSyncCursorByAgentId = {
              ...pruneSyncCursors(state.syncCursorByAgentId, now),
            };
            let cursor = nextSyncCursorByAgentId[normalizedAgentId] ?? createEmptyCursor();
            let processedCount = 0;

            const interactions = [...record.interactions].toSorted(
              (left, right) => left.completedAt - right.completedAt,
            );

            for (const interaction of interactions) {
              if (!interaction.id?.trim()) {
                continue;
              }

              if (shouldSkipInteraction(cursor, interaction.id, interaction.completedAt)) {
                continue;
              }

              const bucketInfo = resolveHourlyBucket(interaction.completedAt);
              const bucket =
                nextHourlyStatsByKey[
                  createHourlyStatsKey(normalizedAgentId, bucketInfo.date, bucketInfo.hour)
                ];
              const nextEntry = applyInteractionToHourlyStats(
                bucket,
                normalizedAgentId,
                interaction,
              );
              nextHourlyStatsByKey[nextEntry.id] = nextEntry;
              cursor = buildNextCursor(cursor, interaction.id, interaction.completedAt);
              processedCount += 1;
            }

            const statsPruned =
              Object.keys(nextHourlyStatsByKey).length !==
              Object.keys(state.hourlyStatsByKey).length;
            const cursorPruned =
              JSON.stringify(nextSyncCursorByAgentId) !== JSON.stringify(state.syncCursorByAgentId);

            if (processedCount === 0 && !statsPruned && !cursorPruned) {
              return state;
            }

            if (processedCount > 0) {
              nextSyncCursorByAgentId[normalizedAgentId] = cursor;
              console.log(
                `[Stats] synced ${processedCount} interaction(s) for ${normalizedAgentId}, totalBuckets=${getHourlyStatsEntries(nextHourlyStatsByKey).length}`,
              );
            }

            return {
              hourlyStatsByKey: nextHourlyStatsByKey,
              syncCursorByAgentId: nextSyncCursorByAgentId,
            };
          });
        },
      };
    },
    {
      name: STATS_STORAGE_KEY,
      storage: createJSONStorage(resolveStatsStorage),
      partialize: (state): PersistedStatsState => ({
        hourlyStatsByKey: state.hourlyStatsByKey,
        syncCursorByAgentId: state.syncCursorByAgentId,
      }),
    },
  ),
);
