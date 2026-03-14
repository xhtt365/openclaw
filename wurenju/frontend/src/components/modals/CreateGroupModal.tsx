import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Crown, Users, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useGroupStore, type AgentInfo, type Group } from "@/stores/groupStore";

type CreateGroupModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (group: Group) => void;
};

type Step = 1 | 2 | 3;

type WizardState = {
  name: string;
  description: string;
  memberIds: string[];
  leaderId: string;
};

const INITIAL_STATE: WizardState = {
  name: "",
  description: "",
  memberIds: [],
  leaderId: "",
};

const STEP_ITEMS = [
  { id: 1, label: "基本信息" },
  { id: 2, label: "选择成员" },
  { id: 3, label: "选择群主" },
] as const;

function toGroupMember(agent: Agent): AgentInfo {
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    avatarUrl: agent.avatarUrl,
    role: agent.role,
  };
}

function resolveAvatarText(agent: Agent) {
  return agent.emoji?.trim() || agent.name.trim().charAt(0).toUpperCase() || "#";
}

function StepProgress({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      {STEP_ITEMS.map((item) => (
        <div
          key={item.id}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"
          aria-hidden="true"
        >
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cf6,#a855f7)]"
            animate={{ width: step >= item.id ? "100%" : "0%" }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          />
        </div>
      ))}
    </div>
  );
}

const MemoStepProgress = memo(StepProgress);
MemoStepProgress.displayName = "CreateGroupStepProgress";

type AgentRowProps = {
  agent: Agent;
  selected: boolean;
  mode: "multiple" | "single";
  onClick: () => void;
};

function AgentRow({ agent, selected, mode, onClick }: AgentRowProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left backdrop-blur-xl transition-all duration-200",
        selected
          ? "border-violet-400/35 bg-violet-500/12 shadow-[0_12px_40px_rgba(139,92,246,0.12)]"
          : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]",
      )}
    >
      <div className="relative shrink-0">
        {agent.avatarUrl ? (
          <img
            alt={agent.name}
            className="h-12 w-12 rounded-full object-cover"
            src={agent.avatarUrl}
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#facc15,#f59e0b)] text-sm font-semibold text-black">
            {resolveAvatarText(agent)}
          </div>
        )}
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border border-[rgba(12,12,16,0.95)] bg-emerald-400" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
          {agent.name}
        </div>
        <div className="mt-1 text-sm text-[var(--color-text-secondary)]">在线</div>
      </div>

      {mode === "multiple" ? (
        <motion.span
          animate={{ scale: selected ? 1 : 0.94 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border",
            selected
              ? "border-violet-400 bg-violet-500 text-white shadow-[0_10px_24px_rgba(139,92,246,0.35)]"
              : "border-white/16 bg-transparent text-transparent",
          )}
        >
          <Check className="h-4 w-4" />
        </motion.span>
      ) : (
        <motion.span
          animate={{ scale: selected ? 1 : 0.94 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border",
            selected
              ? "border-violet-400 bg-violet-500 text-white shadow-[0_10px_24px_rgba(139,92,246,0.35)]"
              : "border-white/16 bg-transparent text-transparent",
          )}
        >
          <Crown className="h-4 w-4" />
        </motion.span>
      )}
    </motion.button>
  );
}

const MemoAgentRow = memo(AgentRow);
MemoAgentRow.displayName = "CreateGroupAgentRow";

function CreateGroupModalInner({ open, onOpenChange, onCreated }: CreateGroupModalProps) {
  const agents = useAgentStore((state) => state.agents);
  const createGroup = useGroupStore((state) => state.createGroup);

  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [wizard, setWizard] = useState<WizardState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedMembers = agents.filter((agent) => wizard.memberIds.includes(agent.id));
  const canNextStep1 = wizard.name.trim().length > 0;
  const canNextStep2 = wizard.memberIds.length >= 2;
  const canCreate = Boolean(wizard.leaderId) && selectedMembers.length >= 2;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setWizard(INITIAL_STATE);
      setIsSubmitting(false);
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onOpenChange, open]);

  useEffect(() => {
    if (!wizard.leaderId) {
      return;
    }

    if (!wizard.memberIds.includes(wizard.leaderId)) {
      setWizard((current) => ({
        ...current,
        leaderId: "",
      }));
    }
  }, [wizard.leaderId, wizard.memberIds]);

  function toggleMember(agentId: string) {
    setWizard((current) => {
      const exists = current.memberIds.includes(agentId);
      return {
        ...current,
        memberIds: exists
          ? current.memberIds.filter((id) => id !== agentId)
          : [...current.memberIds, agentId],
      };
    });
  }

  async function handleCreateGroup() {
    if (isSubmitting || !canCreate) {
      return;
    }

    const members = selectedMembers.map((agent) => toGroupMember(agent));
    setIsSubmitting(true);

    try {
      const group = createGroup({
        name: wizard.name,
        description: wizard.description,
        members,
        leaderId: wizard.leaderId,
      });
      console.log(`[Group] 创建向导完成: ${group.name}`);
      onCreated?.(group);
      onOpenChange(false);
    } catch (error) {
      console.error("[Group] 创建项目组失败:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="create-group-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-md"
          onClick={() => {
            if (!isSubmitting) {
              onOpenChange(false);
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[rgba(12,12,16,0.96)] shadow-[0_48px_140px_rgba(0,0,0,0.45)]"
          >
            <div className="border-b border-white/[0.08] px-8 pb-6 pt-7">
              <div className="flex items-start justify-between gap-6">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] text-[34px] font-semibold text-white shadow-[0_18px_60px_rgba(139,92,246,0.28)]">
                    #
                  </div>
                  <div className="min-w-0">
                    <div className="text-[28px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                      创建项目组
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      步骤 {step}/3
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!isSubmitting) {
                      onOpenChange(false);
                    }
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-white"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-7">
                <MemoStepProgress step={step} />
              </div>
            </div>

            <div className="min-h-[420px] px-8 py-7">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h3 className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        基本信息
                      </h3>
                      <p className="mt-2 text-[15px] text-[var(--color-text-secondary)]">
                        为你的项目组起个名字
                      </p>
                    </div>

                    <div className="space-y-5">
                      <label className="block">
                        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                          项目组名称 <span className="text-rose-400">*</span>
                        </div>
                        <input
                          value={wizard.name}
                          onChange={(event) => {
                            setWizard((current) => ({
                              ...current,
                              name: event.target.value,
                            }));
                          }}
                          placeholder="例如：产品讨论组"
                          className="h-[52px] w-full rounded-[18px] border border-violet-400/25 bg-white/[0.03] px-5 text-[15px] text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-secondary)] focus:border-violet-400/55 focus:bg-white/[0.05] focus:shadow-[0_0_0_1px_rgba(168,85,247,0.22)]"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                          描述（可选）
                        </div>
                        <textarea
                          value={wizard.description}
                          onChange={(event) => {
                            setWizard((current) => ({
                              ...current,
                              description: event.target.value,
                            }));
                          }}
                          rows={5}
                          placeholder="项目组的用途说明"
                          className="w-full resize-none rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-[15px] leading-7 text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-secondary)] focus:border-violet-400/35 focus:bg-white/[0.05]"
                        />
                      </label>
                    </div>
                  </motion.div>
                ) : null}

                {step === 2 ? (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h3 className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        选择群成员
                      </h3>
                      <p className="mt-2 text-[15px] text-[var(--color-text-secondary)]">
                        选择要加入项目组的 Agent
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-[15px] text-[var(--color-text-secondary)]">
                      <Users className="h-5 w-5 text-violet-300" />
                      <span>
                        已选择{" "}
                        <span className="font-semibold text-violet-300">
                          {wizard.memberIds.length}
                        </span>{" "}
                        个成员
                      </span>
                    </div>

                    <div className="im-scroll max-h-[300px] space-y-3 overflow-y-auto pr-1">
                      {agents.map((agent) => {
                        const isSelected = wizard.memberIds.includes(agent.id);
                        return (
                          <MemoAgentRow
                            key={agent.id}
                            agent={agent}
                            selected={isSelected}
                            mode="multiple"
                            onClick={() => {
                              toggleMember(agent.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                ) : null}

                {step === 3 ? (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h3 className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        选择群主
                      </h3>
                      <p className="mt-2 text-[15px] text-[var(--color-text-secondary)]">
                        从已选成员中指定一位作为群主
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-amber-300/18 bg-amber-400/8 px-5 py-4 text-left shadow-[0_12px_40px_rgba(245,158,11,0.08)]">
                      <div className="flex items-center gap-2 text-[17px] font-semibold text-amber-200">
                        <Crown className="h-5 w-5" />
                        群主的职责
                      </div>
                      <div className="mt-3 space-y-2 text-[14px] leading-7 text-amber-100/85">
                        <div>① 默认接收所有消息，确保无遗漏</div>
                        <div>② 协调统筹，分配任务给合适的成员</div>
                      </div>
                    </div>

                    <div className="im-scroll max-h-[240px] space-y-3 overflow-y-auto pr-1">
                      {selectedMembers.map((agent) => (
                        <MemoAgentRow
                          key={agent.id}
                          agent={agent}
                          selected={wizard.leaderId === agent.id}
                          mode="single"
                          onClick={() => {
                            setWizard((current) => ({
                              ...current,
                              leaderId: current.leaderId === agent.id ? "" : agent.id,
                            }));
                          }}
                        />
                      ))}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="border-t border-white/[0.08] px-8 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-h-6 text-sm text-[var(--color-text-secondary)]">
                  {step === 2 && !canNextStep2 ? "至少选择 2 个 Agent 才能继续" : null}
                  {step === 3 && !canCreate ? "请选择一位群主后再创建项目组" : null}
                </div>

                <div className="flex items-center gap-3">
                  {step > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setStep((current) => Math.max(1, current - 1) as Step);
                      }}
                      className="inline-flex h-12 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-5 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.08]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一步
                    </button>
                  ) : null}

                  {step < 3 ? (
                    <button
                      type="button"
                      disabled={(step === 1 && !canNextStep1) || (step === 2 && !canNextStep2)}
                      onClick={() => {
                        setStep((current) => Math.min(3, current + 1) as Step);
                      }}
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] px-6 text-sm font-semibold text-white shadow-[0_12px_36px_rgba(139,92,246,0.28)] transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
                    >
                      下一步
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!canCreate || isSubmitting}
                      onClick={() => {
                        void handleCreateGroup();
                      }}
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] px-6 text-sm font-semibold text-white shadow-[0_12px_36px_rgba(139,92,246,0.28)] transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
                    >
                      {isSubmitting ? "创建中..." : "创建项目组"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export const CreateGroupModal = memo(CreateGroupModalInner);
CreateGroupModal.displayName = "CreateGroupModal";
