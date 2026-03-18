"use client";

import {
  Building2,
  Check,
  GripVertical,
  Layers3,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  clearSidebarDepartmentAssignments,
  writeSidebarDepartments,
  type SidebarAgentMetaMap,
  type SidebarDepartment,
} from "@/utils/sidebarPersistence";

const DEPARTMENT_EMOJIS = [
  "🏢",
  "💻",
  "📋",
  "🎨",
  "📊",
  "🔧",
  "💡",
  "🎯",
  "📱",
  "🛠️",
  "⚡",
  "🔍",
  "📦",
  "🎪",
  "🏗️",
  "📐",
  "🧪",
  "🔬",
  "📈",
  "📣",
  "🧾",
  "🎬",
  "🛡️",
  "🤝",
  "🧠",
  "🚀",
  "🧩",
  "📚",
] as const;

type DepartmentManageModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: SidebarDepartment[];
  agentIds: string[];
  agentMetaById: SidebarAgentMetaMap;
};

type DepartmentDraft = {
  id: string | null;
  icon: string;
  isNew: boolean;
  name: string;
};

function buildMemberCountMap(agentIds: string[], agentMetaById: SidebarAgentMetaMap) {
  const counts: Record<string, number> = {};

  for (const agentId of agentIds) {
    const departmentId = agentMetaById[agentId]?.departmentId;
    if (!departmentId) {
      continue;
    }

    counts[departmentId] = (counts[departmentId] ?? 0) + 1;
  }

  return counts;
}

function reorderDepartments(departments: SidebarDepartment[], sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    return departments;
  }

  const current = [...departments];
  const sourceIndex = current.findIndex((department) => department.id === sourceId);
  const targetIndex = current.findIndex((department) => department.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return departments;
  }

  const [movedDepartment] = current.splice(sourceIndex, 1);
  current.splice(targetIndex, 0, movedDepartment);
  return current;
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  danger?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--color-text-primary)]",
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function EmojiPicker({
  onSelect,
  selectedIcon,
}: {
  onSelect: (icon: string) => void;
  selectedIcon: string;
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-2 w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-lg)]">
      <div className="grid grid-cols-7 gap-2">
        {DEPARTMENT_EMOJIS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => onSelect(icon)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl text-lg transition-colors hover:bg-[var(--bg-hover)]",
              selectedIcon === icon && "bg-[var(--accent-subtle)] ring-1 ring-[var(--accent)]",
            )}
            aria-label={`选择图标 ${icon}`}
          >
            <span aria-hidden="true">{icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  onCancel,
  onSave,
  onTogglePicker,
  pickerOpen,
  setDraft,
}: {
  draft: DepartmentDraft;
  onCancel: () => void;
  onSave: () => void;
  onTogglePicker: () => void;
  pickerOpen: boolean;
  setDraft: (updater: (current: DepartmentDraft) => DepartmentDraft) => void;
}) {
  const trimmedName = draft.name.trim();

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (trimmedName) {
        onSave();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-[var(--accent)] bg-[var(--accent-subtle)] px-3 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted)]">
        <GripVertical className="h-4 w-4" />
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={onTogglePicker}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[20px] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
          aria-label="选择部门图标"
        >
          <span aria-hidden="true">{draft.icon}</span>
        </button>

        {pickerOpen ? (
          <EmojiPicker
            selectedIcon={draft.icon}
            onSelect={(icon) => {
              setDraft((current) => ({
                ...current,
                icon,
              }));
            }}
          />
        ) : null}
      </div>

      <input
        value={draft.name}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft((current) => ({
            ...current,
            name: nextValue,
          }));
        }}
        onKeyDown={handleInputKeyDown}
        placeholder="输入部门名称"
        autoFocus
        className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent-glow)]"
      />

      <div className="flex items-center gap-1">
        <IconButton icon={Check} label="保存部门" onClick={onSave} />
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="取消编辑"
          title="取消编辑"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function DepartmentManageModal({
  open,
  onOpenChange,
  departments,
  agentIds,
  agentMetaById,
}: DepartmentManageModalProps) {
  const [draft, setDraft] = useState<DepartmentDraft | null>(null);
  const [draggingDepartmentId, setDraggingDepartmentId] = useState<string | null>(null);
  const [dropTargetDepartmentId, setDropTargetDepartmentId] = useState<string | null>(null);
  const [pickerOpenForId, setPickerOpenForId] = useState<string | null>(null);
  const [pendingDeleteDepartment, setPendingDeleteDepartment] = useState<SidebarDepartment | null>(
    null,
  );

  const memberCountByDepartmentId = buildMemberCountMap(agentIds, agentMetaById);
  const pendingDeleteCount = pendingDeleteDepartment
    ? (memberCountByDepartmentId[pendingDeleteDepartment.id] ?? 0)
    : 0;
  const assignedCount = Object.values(memberCountByDepartmentId).reduce(
    (total, count) => total + count,
    0,
  );
  const unassignedCount = Math.max(agentIds.length - assignedCount, 0);

  function resetTransientState() {
    setDraft(null);
    setDraggingDepartmentId(null);
    setDropTargetDepartmentId(null);
    setPickerOpenForId(null);
    setPendingDeleteDepartment(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetTransientState();
    }

    onOpenChange(nextOpen);
  }

  function closeModal() {
    handleOpenChange(false);
  }

  function startCreateDepartment() {
    setDraft({
      id: null,
      icon: "🏢",
      isNew: true,
      name: "",
    });
    setPickerOpenForId(null);
  }

  function startEditDepartment(department: SidebarDepartment) {
    setDraft({
      id: department.id,
      icon: department.icon,
      isNew: false,
      name: department.name,
    });
    setPickerOpenForId(null);
  }

  function cancelDraft() {
    setDraft(null);
    setPickerOpenForId(null);
  }

  function saveDraft() {
    if (!draft) {
      return;
    }

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      return;
    }

    if (draft.isNew) {
      writeSidebarDepartments([
        ...departments,
        {
          id: crypto.randomUUID(),
          icon: draft.icon || "🏢",
          name: trimmedName,
          sortOrder: departments.length,
        },
      ]);
      cancelDraft();
      return;
    }

    writeSidebarDepartments(
      departments.map((department) =>
        department.id === draft.id
          ? {
              ...department,
              icon: draft.icon || "🏢",
              name: trimmedName,
            }
          : department,
      ),
    );
    cancelDraft();
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, departmentId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", departmentId);
    setDraggingDepartmentId(departmentId);
    setDropTargetDepartmentId(null);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, departmentId: string) {
    if (!draggingDepartmentId || draggingDepartmentId === departmentId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDepartmentId(departmentId);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, departmentId: string) {
    event.preventDefault();
    const sourceDepartmentId = event.dataTransfer.getData("text/plain") || draggingDepartmentId;
    if (!sourceDepartmentId || sourceDepartmentId === departmentId) {
      setDraggingDepartmentId(null);
      setDropTargetDepartmentId(null);
      return;
    }

    // 原生拖拽只负责交换数组顺序，落盘时统一重排 sortOrder。
    const nextDepartments = reorderDepartments(departments, sourceDepartmentId, departmentId);
    writeSidebarDepartments(nextDepartments);
    setDraggingDepartmentId(null);
    setDropTargetDepartmentId(null);
  }

  function handleDeleteDepartment() {
    if (!pendingDeleteDepartment) {
      return;
    }

    writeSidebarDepartments(
      departments.filter((department) => department.id !== pendingDeleteDepartment.id),
    );
    // 删除部门后只清空归属，置顶等其他元数据要保留。
    clearSidebarDepartmentAssignments(pendingDeleteDepartment.id, agentMetaById);

    if (draft?.id === pendingDeleteDepartment.id) {
      cancelDraft();
    }

    setPendingDeleteDepartment(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(620px,calc(100vw-2rem))] max-w-[620px] gap-0 overflow-hidden rounded-[30px] border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--text-strong)] shadow-[var(--shadow-xl)]"
        >
          <div className="flex max-h-[70vh] flex-col">
            <div
              className="border-b border-[var(--border)] px-6 py-6"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, transparent), transparent 42%, color-mix(in srgb, var(--accent-2) 10%, transparent))",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-subtle)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                    <Building2 className="h-3.5 w-3.5" />
                    部门管理
                  </div>
                  <DialogTitle className="mt-3 text-[26px] font-semibold tracking-tight">
                    调整你的组织架构
                  </DialogTitle>
                  <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                    支持新建、编辑、拖拽排序和删除部门，员工会按部门在侧栏自动归类。
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--color-text-primary)]"
                  aria-label="关闭部门管理"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] px-4 py-4 shadow-[var(--shadow-sm)]">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    <Layers3 className="h-3.5 w-3.5" />
                    部门数
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">
                    {departments.length}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] px-4 py-4 shadow-[var(--shadow-sm)]">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    <Users className="h-3.5 w-3.5" />
                    已分配成员
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">
                    {assignedCount}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] px-4 py-4 shadow-[var(--shadow-sm)]">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    <Users className="h-3.5 w-3.5" />
                    未分组成员
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">
                    {unassignedCount}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-4">
                {departments.length > 0 ? (
                  departments.map((department) => {
                    const isEditing = draft?.id === department.id && !draft.isNew;
                    const isDropTarget =
                      Boolean(dropTargetDepartmentId) &&
                      dropTargetDepartmentId === department.id &&
                      draggingDepartmentId !== department.id;
                    const memberCount = memberCountByDepartmentId[department.id] ?? 0;

                    return (
                      <div
                        key={department.id}
                        onDragOver={(event) => handleDragOver(event, department.id)}
                        onDrop={(event) => handleDrop(event, department.id)}
                        className={cn(
                          "rounded-[24px] border border-[var(--border)] bg-[var(--card)] transition-[border-color,box-shadow,opacity,transform]",
                          isDropTarget &&
                            "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent-glow)]",
                          draggingDepartmentId === department.id && "opacity-60",
                        )}
                        style={{
                          boxShadow: isDropTarget ? "var(--shadow-md)" : "var(--shadow-sm)",
                        }}
                      >
                        {isEditing && draft ? (
                          <div className="p-2">
                            <DraftRow
                              draft={draft}
                              pickerOpen={pickerOpenForId === draft.id}
                              onTogglePicker={() => {
                                setPickerOpenForId((current) =>
                                  current === draft.id ? null : draft.id,
                                );
                              }}
                              onCancel={cancelDraft}
                              onSave={saveDraft}
                              setDraft={(updater) => {
                                setDraft((current) => (current ? updater(current) : current));
                              }}
                            />
                          </div>
                        ) : (
                          <div className="group flex items-center gap-3 px-4 py-4">
                            <div
                              draggable
                              onDragStart={(event) => handleDragStart(event, department.id)}
                              onDragEnd={() => {
                                setDraggingDepartmentId(null);
                                setDropTargetDepartmentId(null);
                              }}
                              className="flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-2xl text-[var(--muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:cursor-grabbing"
                              aria-label={`拖拽排序 ${department.name}`}
                              title="拖拽排序"
                            >
                              <GripVertical className="h-4 w-4" />
                            </div>

                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-[var(--border)] bg-[var(--bg-hover)] text-[20px] shadow-[var(--shadow-sm)]">
                              <span aria-hidden="true">{department.icon}</span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                                {department.name}
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">
                                {memberCount} 人在该部门
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <IconButton
                                icon={Pencil}
                                label={`编辑 ${department.name}`}
                                onClick={() => startEditDepartment(department)}
                              />
                              <IconButton
                                icon={Trash2}
                                label={`删除 ${department.name}`}
                                danger
                                onClick={() => {
                                  setPendingDeleteDepartment(department);
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[26px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-accent)] px-5 py-12 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-[var(--card)] text-[var(--accent)] shadow-[var(--shadow-sm)]">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">
                      还没有部门
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                      先建一个部门，侧栏就会自动按部门展示员工，组织结构也会更清晰。
                    </div>
                  </div>
                )}

                {draft?.isNew ? (
                  <DraftRow
                    draft={draft}
                    pickerOpen={pickerOpenForId === "new"}
                    onTogglePicker={() => {
                      setPickerOpenForId((current) => (current === "new" ? null : "new"));
                    }}
                    onCancel={cancelDraft}
                    onSave={saveDraft}
                    setDraft={(updater) => {
                      setDraft((current) => (current ? updater(current) : current));
                    }}
                  />
                ) : null}

                <button
                  type="button"
                  onClick={startCreateDepartment}
                  className="flex w-full items-center justify-center gap-2 rounded-[24px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-accent)] px-4 py-4 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]"
                >
                  <Plus className="h-4 w-4" />
                  新建部门
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={pendingDeleteDepartment !== null}
        onClose={() => setPendingDeleteDepartment(null)}
        onConfirm={handleDeleteDepartment}
        icon="⚠️"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="删除部门"
        subtitle={pendingDeleteDepartment?.name ?? ""}
        description={`删除后，该部门下 ${pendingDeleteCount} 名员工将移至"未分组"`}
        confirmText="确认删除"
        confirmColor="bg-[var(--danger)] hover:brightness-110"
      />
    </>
  );
}
