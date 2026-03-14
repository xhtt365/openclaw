"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { EmployeeList, type Employee } from "@/components/layout/EmployeeList";
import { ChatArea } from "@/components/layout/ChatArea";
import { EmployeeDetailPage } from "@/components/layout/EmployeeDetailPage";
import { useAgentStore } from "@/stores/agentStore";
import { useGroupStore } from "@/stores/groupStore";

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
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const groups = useGroupStore((state) => state.groups);
  const selectedGroupId = useGroupStore((state) => state.selectedGroupId);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

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

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-[var(--color-bg-primary)]">
      <div
        className={cn(
          "h-full shrink-0",
          isReady ? "panel-left-enter" : ""
        )}
      >
        <EmployeeList selectedEmployeeId={selectedEmployee.id} onSelectEmployee={handleSelectEmployee} />
      </div>
      <div
        className={cn(
          "h-full min-h-0 min-w-0 flex-1",
          isReady ? "panel-right-enter" : ""
        )}
      >
        {showDetailFor !== null && selectedGroup === null ? (
          <EmployeeDetailPage />
        ) : (
          <ChatArea employee={selectedEmployee} group={selectedGroup} />
        )}
      </div>
    </div>
  );
}

export const AppLayout = memo(AppLayoutInner);
AppLayout.displayName = "AppLayout";
