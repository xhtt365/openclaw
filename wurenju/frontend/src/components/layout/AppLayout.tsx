"use client";

import { memo, useEffect, useState } from "react";
import { ChatArea } from "@/components/layout/ChatArea";
import { EmployeeDetailPage } from "@/components/layout/EmployeeDetailPage";
import { EmployeeList, type Employee } from "@/components/layout/EmployeeList";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import { useGroupStore } from "@/stores/groupStore";
import {
  readChatFullscreenPreference,
  writeChatFullscreenPreference,
} from "@/utils/chatFullscreen";

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
  const [isReady, setIsReady] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(() => readChatFullscreenPreference());
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const groups = useGroupStore((state) => state.groups);
  const selectedGroupId = useGroupStore((state) => state.selectedGroupId);
  const selectedArchiveId = useGroupStore((state) => state.selectedArchiveId);
  const archives = useGroupStore((state) => state.archives);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedArchive = archives.find((archive) => archive.id === selectedArchiveId) ?? null;

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
    writeChatFullscreenPreference(isChatFullscreen);
  }, [isChatFullscreen]);

  const isChatSurfaceVisible = showDetailFor === null && selectedArchive === null;
  const isLayoutFullscreen = isChatSurfaceVisible && isChatFullscreen;

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
        {showDetailFor !== null && selectedGroup === null && selectedArchive === null ? (
          <EmployeeDetailPage />
        ) : (
          <ChatArea
            employee={selectedEmployee}
            group={selectedGroup}
            archive={selectedArchive}
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
