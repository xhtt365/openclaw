"use client";

import { memo, useEffect, useState } from "react";
import { ChatArea } from "@/components/layout/ChatArea";
import { EmployeeDetailPage } from "@/components/layout/EmployeeDetailPage";
import { EmployeeList, type Employee } from "@/components/layout/EmployeeList";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import { useArchiveViewStore } from "@/stores/archiveViewStore";
import { useCronStore } from "@/stores/cronStore";
import { useDirectArchiveStore } from "@/stores/directArchiveStore";
import { useGroupStore } from "@/stores/groupStore";
import { AGENT_AVATAR_STORAGE_KEY } from "@/utils/agentAvatar";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import {
  readChatFullscreenPreference,
  writeChatFullscreenPreference,
} from "@/utils/chatFullscreen";
import { readSidebarDirectArchives, subscribeSidebarStorage } from "@/utils/sidebarPersistence";

const DEFAULT_EMPLOYEE: Employee = {
  id: "main",
  name: "虾班助手",
  role: "AI 员工",
  status: "online",
  lastMessage: "",
  timestamp: "",
  avatarColor: "var(--color-brand)",
  avatarText: "🦞",
  emoji: "🦞",
};

function AppLayoutInner() {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee>(DEFAULT_EMPLOYEE);
  const [directArchives, setDirectArchives] = useState(() => readSidebarDirectArchives());
  const [isReady, setIsReady] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(() => readChatFullscreenPreference());
  const [avatarVersion, setAvatarVersion] = useState(0);
  const agents = useAgentStore((state) => state.agents);
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const archiveEmptyState = useArchiveViewStore((state) => state.emptyState);
  const clearArchiveEmptyState = useArchiveViewStore((state) => state.clearArchiveEmptyState);
  const groups = useGroupStore((state) => state.groups);
  const selectedGroupId = useGroupStore((state) => state.selectedGroupId);
  const selectedArchiveId = useGroupStore((state) => state.selectedArchiveId);
  const archives = useGroupStore((state) => state.archives);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);
  const clearSelectedGroup = useGroupStore((state) => state.clearSelectedGroup);
  const clearSelectedArchive = useGroupStore((state) => state.clearSelectedArchive);
  const selectedDirectArchiveId = useDirectArchiveStore((state) => state.selectedDirectArchiveId);
  const clearSelectedDirectArchive = useDirectArchiveStore(
    (state) => state.clearSelectedDirectArchive,
  );
  const initializeCron = useCronStore((state) => state.initialize);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedArchive = archives.find((archive) => archive.id === selectedArchiveId) ?? null;
  const selectedDirectArchive =
    directArchives.find((archive) => archive.id === selectedDirectArchiveId) ?? null;

  function handleSelectEmployee(employee: Employee) {
    setSelectedEmployee(employee);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsReady(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    initializeCron();
  }, [initializeCron]);

  useEffect(() => {
    return subscribeSidebarStorage(() => {
      setDirectArchives(readSidebarDirectArchives());
    });
  }, []);

  useEffect(() => {
    function handleAvatarRefresh(event?: Event) {
      if (event instanceof StorageEvent && event.key && event.key !== AGENT_AVATAR_STORAGE_KEY) {
        return;
      }

      setAvatarVersion((current) => current + 1);
    }

    window.addEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
    window.addEventListener("storage", handleAvatarRefresh);
    return () => {
      window.removeEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
      window.removeEventListener("storage", handleAvatarRefresh);
    };
  }, []);

  useEffect(() => {
    if (selectedGroupId !== null && selectedGroup === null) {
      clearSelectedGroup();
    }
  }, [clearSelectedGroup, selectedGroup, selectedGroupId]);

  useEffect(() => {
    if (selectedArchiveId !== null && selectedArchive === null) {
      clearSelectedArchive();
    }
  }, [clearSelectedArchive, selectedArchive, selectedArchiveId]);

  useEffect(() => {
    if (selectedDirectArchiveId !== null && selectedDirectArchive === null) {
      clearSelectedDirectArchive();
    }
  }, [clearSelectedDirectArchive, selectedDirectArchive, selectedDirectArchiveId]);

  useEffect(() => {
    if (
      showDetailFor !== null ||
      selectedGroup !== null ||
      selectedArchive !== null ||
      selectedDirectArchive !== null
    ) {
      clearArchiveEmptyState();
    }
  }, [
    clearArchiveEmptyState,
    selectedArchive,
    selectedDirectArchive,
    selectedGroup,
    showDetailFor,
  ]);

  useEffect(() => {
    writeChatFullscreenPreference(isChatFullscreen);
  }, [isChatFullscreen]);

  useEffect(() => {
    const matchedAgent = agents.find((agent) => agent.id === selectedEmployee.id);
    if (!matchedAgent) {
      return;
    }

    const avatarInfo = getAgentAvatarInfo(
      matchedAgent.id,
      matchedAgent.avatarUrl ?? matchedAgent.emoji,
      matchedAgent.name,
    );
    const nextAvatarText =
      avatarInfo.type === "image" ? matchedAgent.name.charAt(0) : avatarInfo.value;

    setSelectedEmployee((current) => ({
      ...current,
      name: matchedAgent.name,
      role: matchedAgent.role?.trim() || "",
      avatarText: nextAvatarText || current.avatarText,
      avatarUrl: avatarInfo.type === "image" ? avatarInfo.value : undefined,
      emoji: avatarInfo.type === "emoji" ? avatarInfo.value : matchedAgent.emoji,
    }));
  }, [agents, avatarVersion, selectedEmployee.id]);

  const isChatSurfaceVisible =
    showDetailFor === null && selectedArchive === null && selectedDirectArchive === null;
  const isLayoutFullscreen = isChatSurfaceVisible && isChatFullscreen;
  const shouldRenderArchiveFallback =
    (selectedArchiveId !== null && selectedArchive === null) ||
    (selectedDirectArchiveId !== null && selectedDirectArchive === null);

  return (
    <div
      className={cn(
        "app-layout relative flex h-screen min-h-0 overflow-hidden bg-[var(--color-bg-primary)]",
        // Fix: 问题5 - 全屏状态上提到布局层，用 class 切换隐藏左侧栏并持久化到 localStorage。
        isLayoutFullscreen ? "app-layout--chat-fullscreen" : "",
      )}
    >
      <div className={cn("app-layout__sidebar h-full shrink-0", isReady ? "panel-left-enter" : "")}>
        <EmployeeList
          selectedEmployeeId={selectedEmployee.id}
          onSelectEmployee={handleSelectEmployee}
        />
      </div>
      <div
        className={cn(
          "app-layout__main relative h-full min-h-0 min-w-0 flex-1",
          isReady ? "panel-right-enter" : "",
        )}
      >
        {showDetailFor !== null &&
        selectedGroup === null &&
        selectedArchive === null &&
        selectedDirectArchive === null &&
        !shouldRenderArchiveFallback ? (
          <EmployeeDetailPage />
        ) : shouldRenderArchiveFallback ? (
          <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
            <div className="mx-auto flex h-full w-full max-w-[960px] flex-1 items-center justify-center px-6 py-6">
              <div className="w-full rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-8 py-10 text-center shadow-[var(--shadow-md)] backdrop-blur-xl">
                <div className="text-lg font-semibold text-[var(--color-text-primary)]">
                  归档正在恢复中
                </div>
                <div className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                  当前归档数据还在同步或已失效。系统会自动尝试恢复；如果是历史旧缓存，也会优先按只读模式兼容展示。
                </div>
              </div>
            </div>
          </div>
        ) : archiveEmptyState ? (
          <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
            <div className="mx-auto flex h-full w-full max-w-[960px] flex-1 items-center justify-center px-6 py-6">
              <div className="w-full rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-8 py-10 text-center shadow-[var(--shadow-md)] backdrop-blur-xl">
                <div className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {archiveEmptyState.title}
                </div>
                <div className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                  {archiveEmptyState.description}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <ChatArea
            employee={selectedEmployee}
            group={selectedGroup}
            archive={selectedArchive}
            directArchive={selectedDirectArchive}
            isChatFullscreen={isChatFullscreen}
            onChatFullscreenChange={setIsChatFullscreen}
            onSelectEmployee={handleSelectEmployee}
          />
        )}
        <Toaster className="z-[120]" />
      </div>
    </div>
  );
}

export const AppLayout = memo(AppLayoutInner);
AppLayout.displayName = "AppLayout";
