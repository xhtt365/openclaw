import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ExperienceEntry, TeachingDispatch } from "@/types/growth";
import { createSafeStorageAdapter } from "@/utils/storage";

const EXPERIENCE_STORAGE_KEY = "xiaban.experience.v1";

type ExperienceState = {
  entries: ExperienceEntry[];
  teachingDispatches: TeachingDispatch[];
  upsertEntry: (entry: ExperienceEntry) => void;
  updateEntry: (entryId: string, updater: (entry: ExperienceEntry) => ExperienceEntry) => void;
  enqueueTeaching: (dispatches: TeachingDispatch[]) => void;
  updateTeachingDispatch: (
    dispatchId: string,
    updater: (dispatch: TeachingDispatch) => TeachingDispatch,
  ) => void;
  getEntriesForAgent: (agentId: string) => ExperienceEntry[];
};

type PersistedExperienceState = Pick<ExperienceState, "entries" | "teachingDispatches">;

function resolveExperienceStorage() {
  return createSafeStorageAdapter();
}

export const useExperienceStore = create<ExperienceState>()(
  persist(
    (set, get) => ({
      entries: [],
      teachingDispatches: [],

      upsertEntry: (entry) => {
        console.log(
          `[Experience] 更新经验条目: id=${entry.id}, source=${entry.source}, status=${entry.status}`,
        );
        set((state) => {
          const exists = state.entries.some((item) => item.id === entry.id);
          return {
            entries: exists
              ? state.entries.map((item) => (item.id === entry.id ? entry : item))
              : [entry, ...state.entries].slice(0, 120),
          };
        });
      },

      updateEntry: (entryId, updater) => {
        set((state) => ({
          entries: state.entries.map((entry) => (entry.id === entryId ? updater(entry) : entry)),
        }));
      },

      enqueueTeaching: (dispatches) => {
        if (dispatches.length === 0) {
          return;
        }

        console.log(`[Teach] 新增带教任务: count=${dispatches.length}`);
        set((state) => ({
          teachingDispatches: [...dispatches, ...state.teachingDispatches].slice(0, 240),
        }));
      },

      updateTeachingDispatch: (dispatchId, updater) => {
        set((state) => ({
          teachingDispatches: state.teachingDispatches.map((dispatch) =>
            dispatch.id === dispatchId ? updater(dispatch) : dispatch,
          ),
        }));
      },

      getEntriesForAgent: (agentId) => {
        return get()
          .entries.filter((entry) => entry.source === agentId || entry.appliedTo.includes(agentId))
          .toSorted((left, right) => right.createdAt - left.createdAt);
      },
    }),
    {
      name: EXPERIENCE_STORAGE_KEY,
      storage: createJSONStorage(resolveExperienceStorage),
      partialize: (state): PersistedExperienceState => ({
        entries: state.entries,
        teachingDispatches: state.teachingDispatches,
      }),
    },
  ),
);
