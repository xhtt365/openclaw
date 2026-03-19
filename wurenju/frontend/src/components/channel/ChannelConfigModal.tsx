"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type {
  ChannelConfigDraft,
  ChannelType,
  DingtalkChannelConfig,
  FeishuChannelConfig,
  TelegramChannelConfig,
} from "@/utils/channelConfig";
import {
  createEmptyChannelConfigDraft,
  isChannelSectionComplete,
  readAgentChannelConfig,
  saveAgentChannelSection,
  serializeChannelConfigDraft,
} from "@/utils/channelConfig";

type ChannelConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
};

type SecretVisibilityState = Record<"dingtalk" | "feishu" | "telegram", boolean>;

type ChannelMeta = {
  key: ChannelType;
  label: string;
  description: string;
};

const CHANNELS: ChannelMeta[] = [
  {
    key: "dingtalk",
    label: "钉钉",
    description: "适合团队内部协作和通知。",
  },
  {
    key: "feishu",
    label: "飞书",
    description: "适合飞书团队消息接入。",
  },
  {
    key: "telegram",
    label: "Telegram",
    description: "适合机器人消息和跨地区沟通。",
  },
];

function createSecretVisibilityState(): SecretVisibilityState {
  return {
    dingtalk: false,
    feishu: false,
    telegram: false,
  };
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 rounded-full border border-white/70 shadow-[0_0_0_1px_rgba(15,18,24,0.06)]",
        active ? "bg-[var(--ok)]" : "bg-[var(--muted-foreground)]/40",
      )}
      aria-hidden="true"
    />
  );
}

function ChannelTabButton(props: {
  active: boolean;
  statusActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-all",
        props.active
          ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <span>{props.label}</span>
      <StatusDot active={props.statusActive} />
    </button>
  );
}

function FieldHint({ children }: { children: string }) {
  return <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{children}</p>;
}

function ToggleSwitch(props: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onCheckedChange(!props.checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors",
        props.checked
          ? "border-[var(--color-brand)] bg-[var(--color-brand)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-soft)]",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform",
          props.checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function SecretField(props: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  hint: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">{props.label}</div>
      <div className="relative">
        <Input
          id={props.id}
          type={props.visible ? "text" : "password"}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] pr-11 text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
        />
        <button
          type="button"
          onClick={() => props.onVisibleChange(!props.visible)}
          className="absolute inset-y-0 right-0 inline-flex items-center justify-center px-3 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          aria-label={props.visible ? "隐藏内容" : "显示内容"}
        >
          {props.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <FieldHint>{props.hint}</FieldHint>
    </label>
  );
}

function SectionCard(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <div className="text-base font-semibold text-[var(--color-text-primary)]">
          {props.title}
        </div>
        <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
          {props.description}
        </div>
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

function renderChannelForm(params: {
  activeTab: ChannelType;
  draft: ChannelConfigDraft;
  secretVisibility: SecretVisibilityState;
  onSecretVisibilityChange: (channel: ChannelType, visible: boolean) => void;
  onDingtalkChange: (patch: Partial<DingtalkChannelConfig>) => void;
  onFeishuChange: (patch: Partial<FeishuChannelConfig>) => void;
  onTelegramChange: (patch: Partial<TelegramChannelConfig>) => void;
}) {
  switch (params.activeTab) {
    case "dingtalk":
      return (
        <SectionCard title="钉钉配置" description="把员工接入钉钉后，就能通过钉钉找到它。">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
              应用编号
            </div>
            <Input
              value={params.draft.dingtalk.appId}
              placeholder="粘贴你的钉钉应用编号"
              onChange={(event) => {
                params.onDingtalkChange({ appId: event.target.value });
              }}
              className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
            />
            <FieldHint>在钉钉开放平台 → 你的应用 → 基础信息中复制</FieldHint>
          </label>

          <SecretField
            id="channel-dingtalk-secret"
            label="应用密钥"
            value={params.draft.dingtalk.appSecret}
            placeholder="粘贴你的钉钉应用密钥"
            hint='在同一页面，点击"显示"后复制'
            visible={params.secretVisibility.dingtalk}
            onVisibleChange={(visible) => {
              params.onSecretVisibilityChange("dingtalk", visible);
            }}
            onChange={(value) => {
              params.onDingtalkChange({ appSecret: value });
            }}
          />
        </SectionCard>
      );
    case "feishu":
      return (
        <SectionCard title="飞书配置" description="把员工接入飞书后，就能在飞书里和它对话。">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
              应用编号
            </div>
            <Input
              value={params.draft.feishu.appId}
              placeholder="粘贴你的飞书应用编号"
              onChange={(event) => {
                params.onFeishuChange({ appId: event.target.value });
              }}
              className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
            />
            <FieldHint>在飞书开放平台 → 你的应用 → 凭证与基础信息中复制</FieldHint>
          </label>

          <SecretField
            id="channel-feishu-secret"
            label="应用密钥"
            value={params.draft.feishu.appSecret}
            placeholder="粘贴你的飞书应用密钥"
            hint="在同一页面复制 App Secret"
            visible={params.secretVisibility.feishu}
            onVisibleChange={(visible) => {
              params.onSecretVisibilityChange("feishu", visible);
            }}
            onChange={(value) => {
              params.onFeishuChange({ appSecret: value });
            }}
          />
        </SectionCard>
      );
    case "telegram":
      return (
        <SectionCard title="Telegram 配置" description="先创建机器人，再把令牌粘贴到这里就能用了。">
          <SecretField
            id="channel-telegram-token"
            label="机器人令牌"
            value={params.draft.telegram.botToken}
            placeholder="粘贴你的 Telegram Bot Token"
            hint="在 Telegram 中找 @BotFather，发送 /newbot 创建后获取"
            visible={params.secretVisibility.telegram}
            onVisibleChange={(visible) => {
              params.onSecretVisibilityChange("telegram", visible);
            }}
            onChange={(value) => {
              params.onTelegramChange({ botToken: value });
            }}
          />
        </SectionCard>
      );
  }
}

export function ChannelConfigModal({
  open,
  onOpenChange,
  agentId,
  agentName,
}: ChannelConfigModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ChannelType>("dingtalk");
  const [draft, setDraft] = useState<ChannelConfigDraft>(createEmptyChannelConfigDraft);
  const [baseline, setBaseline] = useState<ChannelConfigDraft>(createEmptyChannelConfigDraft);
  const [secretVisibility, setSecretVisibility] = useState<SecretVisibilityState>(
    createSecretVisibilityState,
  );
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(
    () => serializeChannelConfigDraft(draft) !== serializeChannelConfigDraft(baseline),
    [baseline, draft],
  );

  const activeSection = draft[activeTab];
  const activeSectionComplete = isChannelSectionComplete(activeTab, activeSection);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const stored = readAgentChannelConfig(agentId);
    setDraft(stored);
    setBaseline(stored);
    setActiveTab("dingtalk");
    setSecretVisibility(createSecretVisibilityState());
    setShowCloseConfirm(false);
    setIsSaving(false);
  }, [agentId, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSaving) {
        return;
      }

      event.preventDefault();
      if (isDirty) {
        setShowCloseConfirm(true);
        return;
      }

      onOpenChange(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDirty, isSaving, onOpenChange, open]);

  function updateSection<T extends ChannelType>(channel: T, patch: Partial<ChannelConfigDraft[T]>) {
    setDraft((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        ...patch,
      },
    }));
  }

  function handleSecretVisibilityChange(channel: ChannelType, visible: boolean) {
    setSecretVisibility((current) => ({
      ...current,
      [channel]: visible,
    }));
  }

  function requestClose() {
    if (isSaving) {
      return;
    }

    if (isDirty) {
      setShowCloseConfirm(true);
      return;
    }

    onOpenChange(false);
  }

  async function handleSave() {
    if (!agentId.trim()) {
      toast({
        title: "❌ 保存失败，请重试",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      console.log(`[Channel] 保存渠道配置: agent=${agentId}, channel=${activeTab}`);
      let saved: ChannelConfigDraft;
      switch (activeTab) {
        case "dingtalk":
          saved = saveAgentChannelSection(agentId, "dingtalk", draft.dingtalk);
          break;
        case "feishu":
          saved = saveAgentChannelSection(agentId, "feishu", draft.feishu);
          break;
        case "telegram":
          saved = saveAgentChannelSection(agentId, "telegram", draft.telegram);
          break;
      }
      setBaseline(saved);
      toast({
        title: "✅ 渠道配置已保存",
      });
    } catch (error) {
      console.error("[Channel] 保存渠道配置失败:", error);
      toast({
        title: "❌ 保存失败，请重试",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (!mounted) {
    return null;
  }

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              key="channel-config-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[130] flex items-center justify-center px-4 py-8"
              style={{
                background: "color-mix(in srgb, var(--overlay-strong) 72%, transparent)",
                backdropFilter: "blur(10px)",
              }}
              onClick={requestClose}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                className="flex max-h-[min(760px,calc(100vh-40px))] w-full max-w-[480px] min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--modal-shell-border)] text-[var(--color-text-primary)]"
                style={{
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--modal-shell-bg) 98%, transparent), color-mix(in srgb, var(--card) 96%, transparent))",
                  boxShadow: "var(--modal-shell-shadow)",
                }}
              >
                <div className="border-b border-[var(--color-border)] px-6 pb-5 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                        <span aria-hidden="true">🔗</span>
                        <span>配置渠道</span>
                      </div>
                      <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        把这个员工接到你常用的聊天软件里。
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
                        当前员工：{agentName}
                      </div>
                      <button
                        type="button"
                        onClick={requestClose}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                        aria-label="关闭配置渠道"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="渠道切换">
                    {CHANNELS.map((channel) => (
                      <ChannelTabButton
                        key={channel.key}
                        active={activeTab === channel.key}
                        statusActive={
                          draft[channel.key].enabled &&
                          isChannelSectionComplete(channel.key, draft[channel.key])
                        }
                        label={channel.label}
                        onClick={() => {
                          setActiveTab(channel.key);
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-4 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3">
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">
                      {CHANNELS.find((item) => item.key === activeTab)?.label}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
                      {CHANNELS.find((item) => item.key === activeTab)?.description}
                    </div>
                  </div>

                  {renderChannelForm({
                    activeTab,
                    draft,
                    secretVisibility,
                    onSecretVisibilityChange: handleSecretVisibilityChange,
                    onDingtalkChange: (patch) => {
                      updateSection("dingtalk", patch);
                    },
                    onFeishuChange: (patch) => {
                      updateSection("feishu", patch);
                    },
                    onTelegramChange: (patch) => {
                      updateSection("telegram", patch);
                    },
                  })}
                </div>

                <div className="border-t border-[var(--color-border)] px-6 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ToggleSwitch
                        checked={activeSection.enabled}
                        onCheckedChange={(checked) => {
                          updateSection(activeTab, { enabled: checked });
                        }}
                      />
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          启用此渠道
                        </div>
                        <div className="text-xs text-[var(--color-text-secondary)]">
                          {activeSection.enabled
                            ? activeSectionComplete
                              ? "当前配置完整，保存后会立即生效。"
                              : "你已经打开了此渠道，但还差一点内容没填完。"
                            : "先关闭着也没关系，准备好后再打开。"}
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={() => {
                        void handleSave();
                      }}
                      disabled={isSaving}
                      className="h-10 rounded-2xl px-5"
                    >
                      {isSaving ? "保存中..." : "保存"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}

      <ConfirmModal
        open={showCloseConfirm}
        onClose={() => {
          if (isSaving) {
            return;
          }

          setShowCloseConfirm(false);
        }}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onOpenChange(false);
        }}
        loading={false}
        icon="⚠️"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="关闭配置渠道"
        subtitle="检测到未保存修改"
        description="有未保存的修改，确定关闭吗？"
        confirmText="确定关闭"
        confirmColor="bg-[var(--warn)] hover:brightness-110"
      />
    </>
  );
}
