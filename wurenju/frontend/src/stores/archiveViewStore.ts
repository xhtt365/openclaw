import { create } from "zustand";

type ArchiveEmptyState = {
  title: string;
  description: string;
} | null;

type ArchiveViewState = {
  emptyState: ArchiveEmptyState;
  showDeletedArchiveEmptyState: (archiveTitle: string) => void;
  showGroupDissolvedEmptyState: (groupName: string) => void;
  clearArchiveEmptyState: () => void;
};

export const useArchiveViewStore = create<ArchiveViewState>((set) => ({
  emptyState: null,

  showDeletedArchiveEmptyState: (archiveTitle) => {
    const safeTitle = archiveTitle.trim() || "这份归档";
    console.log(`[Archive] 当前查看的归档已删除: ${safeTitle}`);
    set({
      emptyState: {
        title: "归档已删除",
        description: `${safeTitle} 已从本地归档中移除。你可以从左侧选择其他归档继续查看。`,
      },
    });
  },

  showGroupDissolvedEmptyState: (groupName) => {
    const safeName = groupName.trim() || "当前群聊";
    console.log(`[Group] 当前查看的群聊已解散: ${safeName}`);
    set({
      emptyState: {
        title: "群聊已解散",
        description: `${safeName} 已从项目组列表中移除。当前没有其他项目组可切换，你可以从左侧选择员工或新建项目组继续。`,
      },
    });
  },

  clearArchiveEmptyState: () => {
    set({ emptyState: null });
  },
}));
