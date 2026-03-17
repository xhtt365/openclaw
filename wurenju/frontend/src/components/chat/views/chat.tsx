// 复制自 openclaw 3.13 原版 ui/src/ui/views/chat.ts，用于二开定制

"use client";

import { OpenClawChatSurface } from "@/components/chat/original/OpenClawChatSurface";
import type { Employee } from "@/components/layout/EmployeeList";
import type { Group } from "@/stores/groupStore";

type ChatViewProps = {
  employee: Employee;
  group?: Group | null;
  isChatFullscreen: boolean;
  onChatFullscreenChange: (nextValue: boolean) => void;
  onSelectEmployee?: (employee: Employee) => void;
};

export function OpenClawChatView({
  employee,
  group,
  isChatFullscreen,
  onChatFullscreenChange,
  onSelectEmployee,
}: ChatViewProps) {
  return (
    <OpenClawChatSurface
      employee={employee}
      group={group}
      isChatFullscreen={isChatFullscreen}
      onChatFullscreenChange={onChatFullscreenChange}
      onSelectEmployee={onSelectEmployee}
    />
  );
}
