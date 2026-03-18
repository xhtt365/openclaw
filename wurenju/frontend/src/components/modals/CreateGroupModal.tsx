import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  ImagePlus,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GroupBasicInfoFields } from "@/components/modals/GroupBasicInfoFields";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useGroupStore, type AgentInfo, type Group } from "@/stores/groupStore";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import { toManagedGroupMember } from "@/utils/groupMembers";

type CreateGroupModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (group: Group) => void;
};

type Step = 1 | 2 | 3;

type WizardState = {
  name: string;
  description: string;
  avatarName: string;
  avatarUrl: string;
  memberIds: string[];
  leaderId: string;
};

const INITIAL_STATE: WizardState = {
  name: "",
  description: "",
  avatarName: "",
  avatarUrl: "",
  memberIds: [],
  leaderId: "",
};

const AVATAR_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

const STEP_ITEMS = [
  { id: 1, label: "基本信息" },
  { id: 2, label: "选择成员" },
  { id: 3, label: "选择群主" },
] as const;

const wizardSecondaryButtonClass =
  "inline-flex h-12 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 text-sm font-medium text-[var(--text-strong)] transition-all duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]";

const wizardPrimaryButtonClass =
  "inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold text-[var(--accent-foreground)] transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100";

function resolveAgentAvatarInfo(agent: Agent) {
  return getAgentAvatarInfo(agent.id, agent.avatarUrl ?? agent.emoji, agent.name);
}

function isSupportedAvatarFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|webp|svg)$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("群头像读取失败，请换一张图片再试"));
    });
    reader.addEventListener("error", () => reject(new Error("群头像读取失败，请换一张图片再试")));
    reader.readAsDataURL(file);
  });
}

function GroupAvatarPreview({
  avatarUrl,
  name,
  className,
  textClassName,
}: {
  avatarUrl?: string;
  name: string;
  className?: string;
  textClassName?: string;
}) {
  const label = name.trim() || "项目组";

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-md)]",
        className,
      )}
      style={{
        background: avatarUrl
          ? undefined
          : "linear-gradient(135deg, color-mix(in srgb, var(--accent-2) 78%, var(--card)), color-mix(in srgb, var(--accent) 86%, var(--card)))",
      }}
    >
      {avatarUrl ? (
        <img alt={label} className="h-full w-full object-cover" src={avatarUrl} />
      ) : (
        <span
          className={cn(
            "select-none text-[42px] font-semibold text-[var(--accent-foreground)]",
            textClassName,
          )}
        >
          {label.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function StepProgress({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      {STEP_ITEMS.map((item) => (
        <div
          key={item.id}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
          aria-hidden="true"
        >
          <motion.div
            className="h-full rounded-full"
            animate={{ width: step >= item.id ? "100%" : "0%" }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            style={{
              background: "linear-gradient(90deg, var(--accent-2), var(--accent))",
            }}
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
  const avatarInfo = resolveAgentAvatarInfo(agent);

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left backdrop-blur-xl transition-all duration-200",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-subtle)] shadow-[var(--shadow-md)]"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]",
      )}
    >
      <div className="relative shrink-0">
        {avatarInfo.type === "image" ? (
          <img
            alt={agent.name}
            className="h-12 w-12 rounded-full object-cover"
            src={avatarInfo.value}
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-[var(--accent-foreground)] shadow-[var(--shadow-sm)]"
            style={{
              background: "linear-gradient(135deg, var(--warn), var(--accent))",
            }}
          >
            {avatarInfo.value}
          </div>
        )}
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border border-[var(--card)] bg-[var(--ok)]" />
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
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-glow)]"
              : "border-[var(--border)] bg-transparent text-transparent",
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
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-glow)]"
              : "border-[var(--border)] bg-transparent text-transparent",
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [wizard, setWizard] = useState<WizardState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedMembers = agents.filter((agent) => wizard.memberIds.includes(agent.id));
  const selectedLeader = selectedMembers.find((agent) => agent.id === wizard.leaderId) ?? null;
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

  async function handleAvatarInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedAvatarFile(file)) {
      toast({
        title: "头像格式不支持",
        description: "请上传 PNG、JPG、WEBP 或 SVG 图片",
        variant: "destructive",
      });
      return;
    }

    if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
      toast({
        title: "头像文件过大",
        description: "群头像建议控制在 2MB 以内",
        variant: "destructive",
      });
      return;
    }

    try {
      const avatarUrl = await readFileAsDataUrl(file);
      setWizard((current) => ({
        ...current,
        avatarName: file.name,
        avatarUrl,
      }));
    } catch (error) {
      toast({
        title: "头像上传失败",
        description:
          error instanceof Error && error.message.trim()
            ? error.message
            : "群头像读取失败，请稍后重试",
        variant: "destructive",
      });
    }
  }

  async function handleCreateGroup() {
    if (isSubmitting || !canCreate) {
      return;
    }

    const members: AgentInfo[] = selectedMembers.map((agent) => toManagedGroupMember(agent));
    setIsSubmitting(true);

    try {
      const group = createGroup({
        name: wizard.name,
        avatarUrl: wizard.avatarUrl,
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
          className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-8 backdrop-blur-md"
          style={{
            background: "color-mix(in srgb, var(--bg) 58%, transparent)",
          }}
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
            className="flex max-h-[min(820px,calc(100vh-40px))] w-full max-w-[640px] min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--border)] text-[var(--text-strong)]"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--panel-strong) 96%, transparent))",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <div className="border-b border-[var(--border)] px-7 pb-5 pt-6">
              <div className="flex items-start justify-between gap-6">
                <div className="flex min-w-0 items-center gap-4">
                  <GroupAvatarPreview
                    avatarUrl={wizard.avatarUrl || undefined}
                    name={wizard.name}
                    className="h-14 w-14 rounded-[18px]"
                    textClassName="text-[26px]"
                  />
                  <div className="min-w-0">
                    <div className="text-[26px] font-semibold tracking-tight text-[var(--color-text-primary)]">
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
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card-highlight)] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-strong)]"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-7">
                <MemoStepProgress step={step} />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    <div>
                      <h3 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        基本信息
                      </h3>
                      <p className="mt-1.5 text-[14px] text-[var(--color-text-secondary)]">
                        先设计这个项目组的门面和定位
                      </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef.current?.click();
                          }}
                          className="group flex w-full flex-col items-center rounded-[24px] border border-dashed border-[var(--border-strong)] bg-[var(--card)] px-4 py-4 text-center transition-all duration-200 hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
                        >
                          <GroupAvatarPreview
                            avatarUrl={wizard.avatarUrl || undefined}
                            name={wizard.name}
                            className="h-20 w-20 rounded-[22px]"
                            textClassName="text-[28px]"
                          />
                          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent-subtle)] px-3 py-1 text-sm font-medium text-[var(--accent)]">
                            <ImagePlus className="h-4 w-4" />
                            点击上传群头像
                          </div>
                          <div className="mt-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
                            {wizard.avatarName || "建议使用方形头像，列表和聊天头部会同步显示"}
                          </div>
                        </button>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={AVATAR_UPLOAD_ACCEPT}
                          className="hidden"
                          onChange={(event) => {
                            void handleAvatarInputChange(event);
                          }}
                        />
                      </div>

                      <div className="space-y-4">
                        <GroupBasicInfoFields
                          name={wizard.name}
                          description={wizard.description}
                          onNameChange={(value) => {
                            setWizard((current) => ({
                              ...current,
                              name: value,
                            }));
                          }}
                          onDescriptionChange={(value) => {
                            setWizard((current) => ({
                              ...current,
                              description: value,
                            }));
                          }}
                        />

                        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                          <div className="rounded-[22px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-sm)]">
                            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                              创建建议
                            </div>
                            <div className="mt-2 space-y-1.5 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                              <div>名称短一些，侧边栏展示更利落。</div>
                              <div>描述写职责边界，后面更容易协作。</div>
                            </div>
                          </div>

                          <div className="rounded-[22px] border border-[var(--border)] bg-[var(--bg-accent)] px-4 py-3">
                            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                              预览
                            </div>
                            <div className="mt-2 flex items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-3.5 py-3">
                              <GroupAvatarPreview
                                avatarUrl={wizard.avatarUrl || undefined}
                                name={wizard.name}
                                className="h-12 w-12 rounded-[16px]"
                                textClassName="text-[19px]"
                              />
                              <div className="min-w-0 flex-1 text-left">
                                <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                                  {wizard.name.trim() || "未命名项目组"}
                                </div>
                                <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                                  {wizard.description.trim() ||
                                    "项目组介绍会显示在这里，方便成员快速理解分工。"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
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
                      <Users className="h-5 w-5 text-[var(--accent-2)]" />
                      <span>
                        已选择{" "}
                        <span className="font-semibold text-[var(--accent-2)]">
                          {wizard.memberIds.length}
                        </span>{" "}
                        个成员
                      </span>
                    </div>

                    {selectedMembers.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedMembers.map((member) => (
                          <div
                            key={member.id}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
                          >
                            <span aria-hidden="true">{resolveAgentAvatarInfo(member).value}</span>
                            <span>{member.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

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

                    <div className="rounded-[24px] border border-[var(--warn)] bg-[var(--warn-subtle)] px-5 py-4 text-left shadow-[var(--shadow-md)]">
                      <div className="flex items-center gap-2 text-[17px] font-semibold text-[var(--warn)]">
                        <Crown className="h-5 w-5" />
                        群主的职责
                      </div>
                      <div className="mt-3 space-y-2 text-[14px] leading-7 text-[var(--text)]">
                        <div>① 默认接收所有消息，确保无遗漏</div>
                        <div>② 协调统筹，分配任务给合适的成员</div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
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

                      <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[var(--shadow-sm)]">
                        <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                          创建摘要
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                          <GroupAvatarPreview
                            avatarUrl={wizard.avatarUrl || undefined}
                            name={wizard.name}
                            className="h-14 w-14 rounded-[18px]"
                            textClassName="text-[22px]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                              {wizard.name.trim() || "未命名项目组"}
                            </div>
                            <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                              {selectedMembers.length} 位成员
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 rounded-[18px] bg-[var(--bg-accent)] px-4 py-3 text-sm leading-6 text-[var(--color-text-secondary)]">
                          群主：{selectedLeader?.name ?? "请选择"}
                          。创建后会直接进入该项目组，并在侧边栏显示群头像。
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="border-t border-[var(--border)] px-8 py-5">
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
                      className={wizardSecondaryButtonClass}
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
                      className={wizardPrimaryButtonClass}
                      style={{
                        background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
                        boxShadow: "var(--shadow-md)",
                      }}
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
                      className={wizardPrimaryButtonClass}
                      style={{
                        background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
                        boxShadow: "var(--shadow-md)",
                      }}
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
