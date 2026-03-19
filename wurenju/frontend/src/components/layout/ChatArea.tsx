"use client";

import { memo } from "react";
import { DirectArchiveChatArea } from "@/components/chat/DirectArchiveChatArea";
import { GroupArchiveChatArea } from "@/components/chat/GroupArchiveChatArea";
import { OpenClawChatView } from "@/components/chat/views/chat";
import type { Employee } from "@/components/layout/EmployeeList";
import type { Group, GroupArchive } from "@/stores/groupStore";
import type { SidebarDirectArchive } from "@/utils/sidebarPersistence";

interface ChatAreaProps {
  employee: Employee;
  group?: Group | null;
  archive?: GroupArchive | null;
  directArchive?: SidebarDirectArchive | null;
  isChatFullscreen: boolean;
  onChatFullscreenChange: (nextValue: boolean) => void;
  onSelectEmployee?: (employee: Employee) => void;
}

function ChatAreaInner({
  employee,
  group,
  archive,
  directArchive,
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
    return (
      <div className="flex h-full min-h-0">
        <GroupArchiveChatArea key={archive.id} archive={archive} />
      </div>
    );
  }

  if (directArchive) {
    return (
      <div className="flex h-full min-h-0">
        <DirectArchiveChatArea key={directArchive.id} archive={directArchive} />
      </div>
    );
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
