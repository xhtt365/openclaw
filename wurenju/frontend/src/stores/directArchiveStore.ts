import { create } from "zustand";

type DirectArchiveState = {
  selectedDirectArchiveId: string | null;
  selectDirectArchive: (archiveId: string) => void;
  clearSelectedDirectArchive: () => void;
};

export const useDirectArchiveStore = create<DirectArchiveState>((set) => ({
  selectedDirectArchiveId: null,

  selectDirectArchive: (archiveId) => {
    console.log(`[Archive] 选中 1v1 归档: ${archiveId}`);
    set({ selectedDirectArchiveId: archiveId });
  },

  clearSelectedDirectArchive: () => {
    set({ selectedDirectArchiveId: null });
  },
}));
