"use client";

import { memo } from "react";
import { GroupArchiveChatArea } from "@/components/chat/GroupArchiveChatArea";
import { OpenClawChatView } from "@/components/chat/views/chat";
import type { Employee } from "@/components/layout/EmployeeList";
import type { Group, GroupArchive } from "@/stores/groupStore";

interface ChatAreaProps {
  employee: Employee;
  group?: Group | null;
  archive?: GroupArchive | null;
  isChatFullscreen: boolean;
  onChatFullscreenChange: (nextValue: boolean) => void;
  onSelectEmployee?: (employee: Employee) => void;
}

function ChatAreaInner({
  employee,
  group,
  archive,
  isChatFullscreen,
  onChatFullscreenChange,
  onSelectEmployee,
}: ChatAreaProps) {
  if (group) {
    return (
      <OpenClawChatView
        key={group.id}
        employee={employee}
        group={group}
        isChatFullscreen={isChatFullscreen}
        onChatFullscreenChange={onChatFullscreenChange}
        onSelectEmployee={onSelectEmployee}
      />
    );
  }

  if (archive) {
    return <GroupArchiveChatArea key={archive.id} archive={archive} />;
  }

  return (
    <OpenClawChatView
      employee={employee}
      isChatFullscreen={isChatFullscreen}
      onChatFullscreenChange={onChatFullscreenChange}
      onSelectEmployee={onSelectEmployee}
    />
  );
}

export const ChatArea = memo(ChatAreaInner);
ChatArea.displayName = "ChatArea";
