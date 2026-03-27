"use client";

import { EmployeeList, type Employee } from "@/components/layout/EmployeeList";

interface SidebarProps {
  selectedId: string;
  onSelectEmployee: (employee: Employee) => void;
}

export function Sidebar({ selectedId, onSelectEmployee }: SidebarProps) {
  return <EmployeeList selectedEmployeeId={selectedId} onSelectEmployee={onSelectEmployee} />;
}

export type { Employee };
