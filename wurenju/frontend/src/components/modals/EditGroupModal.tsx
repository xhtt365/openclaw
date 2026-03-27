import { PencilLine, X } from "lucide-react";
import { useMemo, useState } from "react";
import { GroupBasicInfoFields } from "@/components/modals/GroupBasicInfoFields";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useGroupStore, type Group } from "@/stores/groupStore";

type EditGroupModalProps = {
  open: boolean;
  group: Group;
  onClose: () => void;
};

export function EditGroupModal({ open, group, onClose }: EditGroupModalProps) {
  const updateGroupInfo = useGroupStore((state) => state.updateGroupInfo);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onClose();
    }
  }

  function handleSave() {
    if (!canSave) {
      return;
    }

    updateGroupInfo(group.id, {
      name,
      description,
    });
    console.log(`[Group] 已更新项目组信息: ${group.name} -> ${name.trim()}`);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl overflow-hidden rounded-[30px] border border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-2xl"
      >
        <div className="relative">
          <div
            className="absolute inset-x-0 top-0 h-28"
            style={{
              background:
                "radial-gradient(circle at top left, var(--surface-brand-soft), transparent 54%), radial-gradient(circle at top right, var(--brand-glow), transparent 46%)",
            }}
          />

          <div className="relative flex items-start justify-between gap-4 border-b border-[var(--divider)] px-6 pb-5 pt-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-[var(--text-inverse)] shadow-[var(--shadow-sm)]">
                <PencilLine className="h-7 w-7" />
              </div>

              <div className="min-w-0">
                <div className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                  编辑项目组
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  修改名称和描述，顶部与左侧列表会实时同步
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--modal-shell-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)] hover:text-[var(--color-text-primary)]"
              aria-label="关闭编辑项目组弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-6 py-6">
            <GroupBasicInfoFields
              name={name}
              description={description}
              onNameChange={setName}
              onDescriptionChange={setDescription}
            />
          </div>

          <div className="border-t border-[var(--divider)] px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-[var(--color-text-secondary)]">
                {canSave ? "保存后立即生效" : "项目组名称不能为空"}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 items-center rounded-full border border-[var(--modal-shell-border)] bg-[var(--surface-soft)] px-5 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)]"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className={cn(
                    "inline-flex h-11 items-center rounded-full bg-[var(--brand-primary)] px-6 text-sm font-semibold text-[var(--text-inverse)] shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-[var(--brand-hover)] hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100",
                  )}
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
