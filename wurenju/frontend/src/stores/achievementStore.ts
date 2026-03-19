import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AchievementDefinition, AchievementUnlock, RankingSnapshot } from "@/types/growth";
import { ACHIEVEMENT_DEFINITIONS } from "@/utils/growth";
import { createSafeStorageAdapter } from "@/utils/storage";

const ACHIEVEMENT_STORAGE_KEY = "xiaban.achievements.v1";

type AchievementState = {
  definitions: AchievementDefinition[];
  unlocks: AchievementUnlock[];
  rankingSnapshots: RankingSnapshot[];
  unlockAchievement: (unlock: AchievementUnlock) => boolean;
  upsertRankingSnapshot: (snapshot: RankingSnapshot) => void;
  getUnlocksForAgent: (agentId: string) => AchievementUnlock[];
  getLatestRankingSnapshot: () => RankingSnapshot | null;
};

type PersistedAchievementState = Pick<AchievementState, "unlocks" | "rankingSnapshots">;

function resolveAchievementStorage() {
  return createSafeStorageAdapter();
}

export const useAchievementStore = create<AchievementState>()(
  persist(
    (set, get) => ({
      definitions: ACHIEVEMENT_DEFINITIONS,
      unlocks: [],
      rankingSnapshots: [],

      unlockAchievement: (unlock) => {
        const exists = get().unlocks.some(
          (item) => item.agentId === unlock.agentId && item.achievementId === unlock.achievementId,
        );
        if (exists) {
          return false;
        }

        console.log(
          `[Rank] 解锁成就: agent=${unlock.agentId}, achievement=${unlock.achievementId}`,
        );
        set((state) => ({
          unlocks: [unlock, ...state.unlocks].slice(0, 200),
        }));
        return true;
      },

      upsertRankingSnapshot: (snapshot) => {
        console.log(
          `[Rank] 更新排行榜快照: week=${snapshot.weekKey}, items=${snapshot.items.length}`,
        );
        set((state) => {
          const exists = state.rankingSnapshots.some((item) => item.weekKey === snapshot.weekKey);
          const nextSnapshots = exists
            ? state.rankingSnapshots.map((item) =>
                item.weekKey === snapshot.weekKey ? snapshot : item,
              )
            : [snapshot, ...state.rankingSnapshots];

          return {
            rankingSnapshots: nextSnapshots
              .toSorted((left, right) => right.createdAt - left.createdAt)
              .slice(0, 24),
          };
        });
      },

      getUnlocksForAgent: (agentId) => {
        return get()
          .unlocks.filter((unlock) => unlock.agentId === agentId)
          .toSorted((left, right) => right.unlockedAt - left.unlockedAt);
      },

      getLatestRankingSnapshot: () => {
        return (
          get()
            .rankingSnapshots.toSorted((left, right) => right.createdAt - left.createdAt)
            .at(0) ?? null
        );
      },
    }),
    {
      name: ACHIEVEMENT_STORAGE_KEY,
      storage: createJSONStorage(resolveAchievementStorage),
      partialize: (state): PersistedAchievementState => ({
        unlocks: state.unlocks,
        rankingSnapshots: state.rankingSnapshots,
      }),
    },
  ),
);
