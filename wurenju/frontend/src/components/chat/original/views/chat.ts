// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/views/chat.ts，用于二开定制

import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { isChatSearchShortcut } from "../chat-shortcuts.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../chat/attachment-support.ts";
import { DeletedMessages } from "../chat/deleted-messages.ts";
import { exportChatMarkdown } from "../chat/export.ts";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { InputHistory } from "../chat/input-history.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { PinnedMessages } from "../chat/pinned-messages.ts";
import { getPinnedMessageSummary } from "../chat/pinned-summary.ts";
import { messageMatchesSearchQuery } from "../chat/search-match.ts";
import { getOrCreateSessionCacheValue } from "../chat/session-cache.ts";
import {
  CATEGORY_LABELS,
  SLASH_COMMANDS,
  getSlashCommandCompletions,
  type SlashCommandCategory,
  type SlashCommandDef,
} from "../chat/slash-commands.ts";
import { isSttSupported, startStt, stopStt } from "../chat/speech.ts";
import {
  shouldHideSystemToolMessage,
  shouldHideSystemToolStreamText,
} from "../chat/system-message-filter.ts";
import { icons } from "../icons.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import { agentLogoUrl, resolveAgentAvatarUrl } from "./agents-utils.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type FallbackIndicatorStatus = {
  phase?: "active" | "cleared";
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
};

export type ChatProps = {
  sessionKey: string;
  conversationMode?: "direct" | "group";
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  loading: boolean;
  newSessionLoading?: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  fallbackStatus?: FallbackIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number }>;
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  assistantAvatarText?: string;
  assistantAvatarColor?: string;
  assistantAgentId?: string | null;
  userAvatar?: string | null;
  userName?: string | null;
  draft: string;
  inputPlaceholder?: string;
  messageTextDecorator?: (markdown: string) => string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  attachments?: ChatAttachment[];
  hideAttachmentButton?: boolean;
  groupCompose?: {
    previewHtml: string;
    mentionQuery: string;
    mentionOpen: boolean;
    mentionActiveIndex: number;
    mentionMembers: Array<{
      id: string;
      name: string;
      avatarText: string;
      avatarUrl?: string;
      avatarColor?: string;
      role?: string;
    }>;
    quickMentionMembers: Array<{
      id: string;
      name: string;
    }>;
    onMentionSelect: (memberId: string) => void;
    onMentionNavigate: (direction: "prev" | "next") => void;
    onMentionActiveIndexChange: (index: number) => void;
    onMentionDismiss: () => void;
  };
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  getDraft?: () => string;
  onDraftChange: (next: string, selectionStart?: number) => void;
  onDraftSelectionChange?: (selectionStart: number) => void;
  onDraftFocusChange?: (focused: boolean) => void;
  onRequestUpdate?: () => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onCompactSession?: () => void;
  onArchiveSession?: () => void;
  onResetSession?: () => void;
  onClearHistory?: () => void;
  onUserAvatarClick?: (target: HTMLElement) => void;
  onAssistantAvatarClick?: (agentId: string, target: HTMLElement) => void;
  quickActionDisabled?: boolean;
  agentsList: {
    agents: Array<{ id: string; name?: string; identity?: { name?: string; avatarUrl?: string } }>;
    defaultId?: string;
  } | null;
  currentAgentId: string;
  onAgentChange: (agentId: string) => void;
  onNavigateToAgent?: () => void;
  onSessionSelect?: (sessionKey: string) => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  basePath?: string;
};

const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

// Persistent instances keyed by session
const inputHistories = new Map<string, InputHistory>();
const pinnedMessagesMap = new Map<string, PinnedMessages>();
const deletedMessagesMap = new Map<string, DeletedMessages>();

function getInputHistory(sessionKey: string): InputHistory {
  return getOrCreateSessionCacheValue(inputHistories, sessionKey, () => new InputHistory());
}

function getPinnedMessages(sessionKey: string): PinnedMessages {
  return getOrCreateSessionCacheValue(
    pinnedMessagesMap,
    sessionKey,
    () => new PinnedMessages(sessionKey),
  );
}

function getDeletedMessages(sessionKey: string): DeletedMessages {
  return getOrCreateSessionCacheValue(
    deletedMessagesMap,
    sessionKey,
    () => new DeletedMessages(sessionKey),
  );
}

interface ChatEphemeralState {
  sttRecording: boolean;
  sttInterimText: string;
  commandPaletteOpen: boolean;
  commandPaletteQuery: string;
  commandPaletteIndex: number;
  slashMenuOpen: boolean;
  slashMenuItems: SlashCommandDef[];
  slashMenuIndex: number;
  slashMenuMode: "command" | "args";
  slashMenuCommand: SlashCommandDef | null;
  slashMenuArgItems: string[];
  searchOpen: boolean;
  searchQuery: string;
  pinnedExpanded: boolean;
}

function createChatEphemeralState(): ChatEphemeralState {
  return {
    sttRecording: false,
    sttInterimText: "",
    commandPaletteOpen: false,
    commandPaletteQuery: "",
    commandPaletteIndex: 0,
    slashMenuOpen: false,
    slashMenuItems: [],
    slashMenuIndex: 0,
    slashMenuMode: "command",
    slashMenuCommand: null,
    slashMenuArgItems: [],
    searchOpen: false,
    searchQuery: "",
    pinnedExpanded: false,
  };
}

const vs = createChatEphemeralState();

/**
 * Reset chat view ephemeral state when navigating away.
 * Stops STT recording and clears search/slash UI that should not survive navigation.
 */
export function resetChatViewState() {
  if (vs.sttRecording) {
    stopStt();
  }
  Object.assign(vs, createChatEphemeralState());
}

export const cleanupChatModuleState = resetChatViewState;

function focusVisibleChatSearchInput() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('[data-chat-search-input="true"]')?.focus();
  });
}

export function toggleChatSearch(forceOpen?: boolean) {
  vs.searchOpen = typeof forceOpen === "boolean" ? forceOpen : !vs.searchOpen;
  if (!vs.searchOpen) {
    vs.searchQuery = "";
  }
  return vs.searchOpen;
}

function focusComposerTextarea() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".agent-chat__textarea")?.focus();
  });
}

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  if (status.active) {
    return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
  }
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
    }
  }
  return nothing;
}

function renderFallbackIndicator(status: FallbackIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  const phase = status.phase ?? "active";
  const elapsed = Date.now() - status.occurredAt;
  if (elapsed >= FALLBACK_TOAST_DURATION_MS) {
    return nothing;
  }
  const details = [
    `Selected: ${status.selected}`,
    phase === "cleared" ? `Active: ${status.selected}` : `Active: ${status.active}`,
    phase === "cleared" && status.previous ? `Previous fallback: ${status.previous}` : null,
    status.reason ? `Reason: ${status.reason}` : null,
    status.attempts.length > 0 ? `Attempts: ${status.attempts.slice(0, 3).join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const message =
    phase === "cleared"
      ? `Fallback cleared: ${status.selected}`
      : `Fallback active: ${status.active}`;
  const className =
    phase === "cleared"
      ? "compaction-indicator compaction-indicator--fallback-cleared"
      : "compaction-indicator compaction-indicator--fallback";
  const icon = phase === "cleared" ? icons.check : icons.brain;
  return html`
    <div class=${className} role="status" aria-live="polite" title=${details}>
      ${icon} ${message}
    </div>
  `;
}

/**
 * Compact notice when context usage reaches 85%+.
 * Progressively shifts from amber (85%) to red (90%+).
 */
function renderContextNotice(
  session: GatewaySessionRow | undefined,
  defaultContextTokens: number | null,
) {
  const used = session?.inputTokens ?? 0;
  const limit = session?.contextTokens ?? defaultContextTokens ?? 0;
  if (!used || !limit) {
    return nothing;
  }
  const ratio = used / limit;
  if (ratio < 0.85) {
    return nothing;
  }
  const pct = Math.min(Math.round(ratio * 100), 100);
  // Lerp from amber (#d97706) at 85% to red (#dc2626) at 95%+
  const t = Math.min(Math.max((ratio - 0.85) / 0.1, 0), 1);
  // RGB: amber(217,119,6) → red(220,38,38)
  const r = Math.round(217 + (220 - 217) * t);
  const g = Math.round(119 + (38 - 119) * t);
  const b = Math.round(6 + (38 - 6) * t);
  const color = `rgb(${r}, ${g}, ${b})`;
  const bgOpacity = 0.08 + 0.08 * t;
  const bg = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;
  return html`
    <div class="context-notice" role="status" style="--ctx-color:${color};--ctx-bg:${bg}">
      <svg class="context-notice__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span>${pct}% context used</span>
      <span class="context-notice__detail">${formatTokensCompact(used)} / ${formatTokensCompact(limit)}</span>
    </div>
  `;
}

/** Format token count compactly (e.g. 128000 → "128k"). */
function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }
  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }
  if (imageItems.length === 0) {
    return;
  }
  e.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type,
      };
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, newAttachment]);
    });
    reader.readAsDataURL(file);
  }
}

function handleFileSelect(e: Event, props: ChatProps) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  for (const file of input.files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
      }
    });
    reader.readAsDataURL(file);
  }
  input.value = "";
}

function handleDrop(e: DragEvent, props: ChatProps) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  for (const file of files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
      }
    });
    reader.readAsDataURL(file);
  }
}

function renderAttachmentPreview(props: ChatProps): TemplateResult | typeof nothing {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-attachments-preview">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment-thumb">
            <img src=${att.dataUrl} alt="Attachment preview" />
            <button
              class="chat-attachment-remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >&times;</button>
          </div>
        `,
      )}
    </div>
  `;
}

function resetSlashMenuState(): void {
  vs.slashMenuMode = "command";
  vs.slashMenuCommand = null;
  vs.slashMenuArgItems = [];
  vs.slashMenuItems = [];
}

function updateSlashMenu(value: string, requestUpdate: () => void): void {
  // Arg mode: /command <partial-arg>
  const argMatch = value.match(/^\/(\S+)\s(.*)$/);
  if (argMatch) {
    const cmdName = argMatch[1].toLowerCase();
    const argFilter = argMatch[2].toLowerCase();
    const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
    if (cmd?.argOptions?.length) {
      const filtered = argFilter
        ? cmd.argOptions.filter((opt) => opt.toLowerCase().startsWith(argFilter))
        : cmd.argOptions;
      if (filtered.length > 0) {
        vs.slashMenuMode = "args";
        vs.slashMenuCommand = cmd;
        vs.slashMenuArgItems = filtered;
        vs.slashMenuOpen = true;
        vs.slashMenuIndex = 0;
        vs.slashMenuItems = [];
        requestUpdate();
        return;
      }
    }
    vs.slashMenuOpen = false;
    resetSlashMenuState();
    requestUpdate();
    return;
  }

  // Command mode: /partial-command
  const match = value.match(/^\/(\S*)$/);
  if (match) {
    const items = getSlashCommandCompletions(match[1]);
    vs.slashMenuItems = items;
    vs.slashMenuOpen = items.length > 0;
    vs.slashMenuIndex = 0;
    vs.slashMenuMode = "command";
    vs.slashMenuCommand = null;
    vs.slashMenuArgItems = [];
  } else {
    vs.slashMenuOpen = false;
    resetSlashMenuState();
  }
  requestUpdate();
}

function selectSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Transition to arg picker when the command has fixed options
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();

  if (cmd.executeLocal && !cmd.args) {
    props.onDraftChange(`/${cmd.name}`);
    requestUpdate();
    props.onSend();
  } else {
    props.onDraftChange(`/${cmd.name} `);
    requestUpdate();
  }
}

function tabCompleteSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Tab: fill in the command text without executing
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(cmd.args ? `/${cmd.name} ` : `/${cmd.name}`);
  requestUpdate();
}

function selectSlashArg(
  arg: string,
  props: ChatProps,
  requestUpdate: () => void,
  execute: boolean,
): void {
  const cmdName = vs.slashMenuCommand?.name ?? "";
  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(`/${cmdName} ${arg}`);
  requestUpdate();
  if (execute) {
    props.onSend();
  }
}

function tokenEstimate(draft: string): string | null {
  if (draft.length < 100) {
    return null;
  }
  return `~${Math.ceil(draft.length / 4)} tokens`;
}

function closeCommandPalette(requestUpdate: () => void): void {
  vs.commandPaletteOpen = false;
  vs.commandPaletteQuery = "";
  vs.commandPaletteIndex = 0;
  requestUpdate();
  focusComposerTextarea();
}

function selectCommandPaletteItem(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  const nextDraft = `/${cmd.name} `;
  props.onDraftChange(nextDraft, nextDraft.length);
  closeCommandPalette(requestUpdate);
}

function scrollActivePaletteItemIntoView() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    document.querySelector(".cmd-palette__item--active")?.scrollIntoView({ block: "nearest" });
  });
}

/**
 * Export chat markdown - delegates to shared utility.
 */
function exportMarkdown(props: ChatProps): void {
  exportChatMarkdown(props.messages, props.assistantName);
}

const DIRECT_WELCOME_SUGGESTIONS = [
  "你现在能帮我做什么？",
  "总结一下最近的会话",
  "帮我检查当前状态",
  "给我一个下一步建议",
] as const;

const GROUP_WELCOME_SUGGESTIONS = [
  "先做个自我介绍",
  "同步一下当前分工",
  "总结最近讨论重点",
  "安排下一步协作",
] as const;

function renderWelcomeState(props: ChatProps): TemplateResult {
  const name = props.assistantName || "Assistant";
  const isGroupConversation = props.conversationMode === "group";
  const avatar = resolveAgentAvatarUrl({
    identity: {
      avatar: props.assistantAvatar ?? undefined,
      avatarUrl: props.assistantAvatarUrl ?? undefined,
    },
  });
  const logoUrl = agentLogoUrl(props.basePath ?? "");
  const welcomeBadge = isGroupConversation ? "项目组已就位" : "随时开始对话";
  const welcomeHint = isGroupConversation
    ? "在下方输入消息，或点按快捷 @ 发起协作"
    : "在下方输入消息，也可以按 / 使用命令";
  const welcomeSuggestions = isGroupConversation
    ? GROUP_WELCOME_SUGGESTIONS
    : DIRECT_WELCOME_SUGGESTIONS;

  return html`
    <div class="agent-chat__welcome" style="--agent-color: var(--accent)">
      <div class="agent-chat__welcome-glow"></div>
      ${
        avatar
          ? html`<img src=${avatar} alt=${name} style="width:56px; height:56px; border-radius:50%; object-fit:cover;" />`
          : html`<div class="agent-chat__avatar agent-chat__avatar--logo"><img src=${logoUrl} alt="OpenClaw" /></div>`
      }
      <h2>${name}</h2>
      <div class="agent-chat__badges">
        <span class="agent-chat__badge"><img src=${logoUrl} alt="" /> ${welcomeBadge}</span>
      </div>
      <p class="agent-chat__hint">${welcomeHint}</p>
      <div class="agent-chat__suggestions">
        ${welcomeSuggestions.map(
          (text) => html`
            <button
              type="button"
              class="agent-chat__suggestion"
              @click=${() => {
                props.onDraftChange(text);
                props.onSend();
              }}
            >${text}</button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderSearchBar(requestUpdate: () => void): TemplateResult | typeof nothing {
  if (!vs.searchOpen) {
    return nothing;
  }
  return html`
    <div class="agent-chat__search-bar">
      ${icons.search}
      <input
        type="text"
        data-chat-search-input="true"
        aria-label="搜索消息"
        placeholder="Search messages..."
        .value=${vs.searchQuery}
        @input=${(e: Event) => {
          vs.searchQuery = (e.target as HTMLInputElement).value;
          requestUpdate();
        }}
      />
      <button class="btn-ghost" @click=${() => {
        vs.searchOpen = false;
        vs.searchQuery = "";
        requestUpdate();
      }}>
        ${icons.x}
      </button>
    </div>
  `;
}

function renderQuickActions(props: ChatProps): TemplateResult | typeof nothing {
  const isGroupConversation = props.conversationMode === "group";
  const hasMessages = Array.isArray(props.messages) && props.messages.length > 0;
  const actionsDisabled = Boolean(props.quickActionDisabled);

  const actions = isGroupConversation
    ? [
        {
          key: "export",
          label: "导出",
          icon: icons.download,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled,
          onClick: () => {
            exportMarkdown(props);
          },
        },
        {
          key: "archive",
          label: "归档",
          icon: icons.folder,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled || !props.onArchiveSession,
          onClick: () => {
            props.onArchiveSession?.();
          },
        },
        {
          key: "reset",
          label: "重置",
          icon: icons.refresh,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled || !props.onResetSession,
          onClick: () => {
            props.onResetSession?.();
          },
        },
      ]
    : [
        {
          key: "compact",
          label: "压缩",
          icon: icons.loader,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled || !props.onCompactSession,
          onClick: () => {
            props.onCompactSession?.();
          },
        },
        {
          key: "archive",
          label: "归档",
          icon: icons.folder,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled || !props.onArchiveSession,
          onClick: () => {
            props.onArchiveSession?.();
          },
        },
        {
          key: "reset",
          label: "重置",
          icon: icons.refresh,
          tone: "neutral",
          disabled: !hasMessages || actionsDisabled || !props.onResetSession,
          onClick: () => {
            props.onResetSession?.();
          },
        },
      ];

  return html`
    <div class="agent-chat__quick-actions" aria-label="聊天快捷操作">
      ${actions.map(
        (action) => html`
          <button
            type="button"
            class="agent-chat__quick-action agent-chat__quick-action--${action.tone}"
            ?disabled=${action.disabled}
            @click=${action.onClick}
          >
            <span class="agent-chat__quick-action-icon">${action.icon}</span>
            <span>${action.label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function renderCommandPalette(
  requestUpdate: () => void,
  props: ChatProps,
): TemplateResult | typeof nothing {
  if (!vs.commandPaletteOpen) {
    return nothing;
  }

  const items = getSlashCommandCompletions(vs.commandPaletteQuery);
  const activeIndex =
    items.length > 0 ? Math.min(vs.commandPaletteIndex, items.length - 1) : vs.commandPaletteIndex;
  const grouped = new Map<
    SlashCommandCategory,
    Array<{ cmd: SlashCommandDef; globalIndex: number }>
  >();

  items.forEach((cmd, globalIndex) => {
    const category = cmd.category ?? "session";
    const current = grouped.get(category) ?? [];
    current.push({ cmd, globalIndex });
    grouped.set(category, current);
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (items.length === 0) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette(requestUpdate);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        vs.commandPaletteIndex = (activeIndex + 1) % items.length;
        requestUpdate();
        scrollActivePaletteItemIntoView();
        return;
      case "ArrowUp":
        event.preventDefault();
        vs.commandPaletteIndex = (activeIndex - 1 + items.length) % items.length;
        requestUpdate();
        scrollActivePaletteItemIntoView();
        return;
      case "Enter":
        event.preventDefault();
        selectCommandPaletteItem(items[activeIndex], props, requestUpdate);
        return;
      case "Escape":
        event.preventDefault();
        closeCommandPalette(requestUpdate);
        return;
    }
  };

  return html`
    <div
      class="cmd-palette-overlay"
      @click=${() => {
        closeCommandPalette(requestUpdate);
      }}
    >
      <div
        class="cmd-palette"
        @click=${(event: Event) => {
          event.stopPropagation();
        }}
        @keydown=${handleKeydown}
      >
        <input
          ${ref((element) => {
            if (element) {
              window.requestAnimationFrame(() => {
                (element as HTMLInputElement).focus();
              });
            }
          })}
          class="cmd-palette__input"
          type="text"
          placeholder="搜索命令，或直接输入 /"
          .value=${vs.commandPaletteQuery}
          @input=${(event: Event) => {
            vs.commandPaletteQuery = (event.target as HTMLInputElement).value;
            vs.commandPaletteIndex = 0;
            requestUpdate();
          }}
        />

        <div class="cmd-palette__results">
          ${
            grouped.size === 0
              ? html`
                  <div class="cmd-palette__empty">
                    <span class="cmd-palette__empty-icon">${icons.search}</span>
                    <span>没有找到匹配命令</span>
                  </div>
                `
              : Array.from(grouped.entries()).map(
                  ([category, commands]) => html`
                    <div class="cmd-palette__group-label">${CATEGORY_LABELS[category]}</div>
                    ${commands.map(
                      ({ cmd, globalIndex }) => html`
                        <button
                          type="button"
                          class="cmd-palette__item ${globalIndex === activeIndex ? "cmd-palette__item--active" : ""}"
                          @click=${() => {
                            selectCommandPaletteItem(cmd, props, requestUpdate);
                          }}
                          @mouseenter=${() => {
                            vs.commandPaletteIndex = globalIndex;
                            requestUpdate();
                          }}
                        >
                          <span class="cmd-palette__item-icon">
                            ${cmd.icon ? icons[cmd.icon] : icons.terminal}
                          </span>
                          <span class="cmd-palette__item-body">
                            <span class="cmd-palette__item-title">${cmd.title}</span>
                            <span class="cmd-palette__item-desc">${cmd.description}</span>
                          </span>
                          <span class="cmd-palette__item-command"
                            >/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}</span
                          >
                        </button>
                      `,
                    )}
                  `,
                )
          }
        </div>

        <div class="cmd-palette__footer">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 填入命令</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  `;
}

function renderGroupMentionPopover(_props: NonNullable<ChatProps["groupCompose"]>) {
  // 群聊已经有底部快捷 @，这里移除输入框联想弹层，避免一处输入出现两套提及入口。
  return nothing;
}

function renderGroupQuickMentions(props: NonNullable<ChatProps["groupCompose"]>) {
  if (props.quickMentionMembers.length === 0) {
    return nothing;
  }

  return html`
    <div class="surface-group-quick-mentions" aria-label="快捷提及成员">
      ${props.quickMentionMembers.map(
        (member) => html`
          <button
            type="button"
            class="surface-group-quick-mentions__chip"
            @click=${() => {
              props.onMentionSelect(member.id);
            }}
          >
            @${member.name}
          </button>
        `,
      )}
    </div>
  `;
}

function renderPinnedSection(
  props: ChatProps,
  pinned: PinnedMessages,
  requestUpdate: () => void,
): TemplateResult | typeof nothing {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const entries: Array<{ index: number; text: string; role: string }> = [];
  for (const idx of pinned.indices) {
    const msg = messages[idx] as Record<string, unknown> | undefined;
    if (!msg) {
      continue;
    }
    const text = getPinnedMessageSummary(msg);
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    entries.push({ index: idx, text, role });
  }
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div class="agent-chat__pinned">
      <button class="agent-chat__pinned-toggle" @click=${() => {
        vs.pinnedExpanded = !vs.pinnedExpanded;
        requestUpdate();
      }}>
        ${icons.bookmark}
        ${entries.length} pinned
        ${vs.pinnedExpanded ? icons.chevronDown : icons.chevronRight}
      </button>
      ${
        vs.pinnedExpanded
          ? html`
            <div class="agent-chat__pinned-list">
              ${entries.map(
                ({ index, text, role }) => html`
                <div class="agent-chat__pinned-item">
                  <span class="agent-chat__pinned-role">${role === "user" ? "You" : "Assistant"}</span>
                  <span class="agent-chat__pinned-text">${text.slice(0, 100)}${text.length > 100 ? "..." : ""}</span>
                  <button class="btn-ghost" @click=${() => {
                    pinned.unpin(index);
                    requestUpdate();
                  }} title="Unpin">
                    ${icons.x}
                  </button>
                </div>
              `,
              )}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderSlashMenu(
  requestUpdate: () => void,
  props: ChatProps,
): TemplateResult | typeof nothing {
  if (!vs.slashMenuOpen) {
    return nothing;
  }

  // Arg-picker mode: show options for the selected command
  if (vs.slashMenuMode === "args" && vs.slashMenuCommand && vs.slashMenuArgItems.length > 0) {
    return html`
      <div class="slash-menu">
        <div class="slash-menu-group">
          <div class="slash-menu-group__label">
            ${vs.slashMenuCommand.title} · /${vs.slashMenuCommand.name}
          </div>
          ${vs.slashMenuArgItems.map(
            (arg, i) => html`
              <div
                class="slash-menu-item ${i === vs.slashMenuIndex ? "slash-menu-item--active" : ""}"
                @click=${() => selectSlashArg(arg, props, requestUpdate, true)}
                @mouseenter=${() => {
                  vs.slashMenuIndex = i;
                  requestUpdate();
                }}
              >
                ${vs.slashMenuCommand?.icon ? html`<span class="slash-menu-icon">${icons[vs.slashMenuCommand.icon]}</span>` : nothing}
                <span class="slash-menu-name">${arg}</span>
                <span class="slash-menu-args">/${vs.slashMenuCommand?.name} ${arg}</span>
                <span class="slash-menu-desc">${vs.slashMenuCommand?.description ?? ""}</span>
              </div>
            `,
          )}
        </div>
        <div class="slash-menu-footer">
          <kbd>↑↓</kbd> 选择
          <kbd>Tab</kbd> 补全
          <kbd>Enter</kbd> 执行
          <kbd>Esc</kbd> 关闭
        </div>
      </div>
    `;
  }

  // Command mode: show grouped commands
  if (vs.slashMenuItems.length === 0) {
    return nothing;
  }

  const grouped = new Map<
    SlashCommandCategory,
    Array<{ cmd: SlashCommandDef; globalIdx: number }>
  >();
  for (let i = 0; i < vs.slashMenuItems.length; i++) {
    const cmd = vs.slashMenuItems[i];
    const cat = cmd.category ?? "session";
    let list = grouped.get(cat);
    if (!list) {
      list = [];
      grouped.set(cat, list);
    }
    list.push({ cmd, globalIdx: i });
  }

  const sections: TemplateResult[] = [];
  for (const [cat, entries] of grouped) {
    sections.push(html`
      <div class="slash-menu-group">
        <div class="slash-menu-group__label">${CATEGORY_LABELS[cat]}</div>
        ${entries.map(
          ({ cmd, globalIdx }) => html`
            <div
              class="slash-menu-item ${globalIdx === vs.slashMenuIndex ? "slash-menu-item--active" : ""}"
              @click=${() => selectSlashCommand(cmd, props, requestUpdate)}
              @mouseenter=${() => {
                vs.slashMenuIndex = globalIdx;
                requestUpdate();
              }}
            >
              ${cmd.icon ? html`<span class="slash-menu-icon">${icons[cmd.icon]}</span>` : nothing}
              <span class="slash-menu-name">${cmd.title}</span>
              <span class="slash-menu-args">/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}</span>
              <span class="slash-menu-desc">${cmd.description}</span>
              ${
                cmd.argOptions?.length
                  ? html`<span class="slash-menu-badge">${cmd.argOptions.length} 个选项</span>`
                  : cmd.executeLocal && !cmd.args
                    ? html`
                        <span class="slash-menu-badge">直接可用</span>
                      `
                    : nothing
              }
            </div>
          `,
        )}
      </div>
    `);
  }

  return html`
    <div class="slash-menu">
      ${sections}
      <div class="slash-menu-footer">
        <kbd>↑↓</kbd> 选择
        <kbd>Tab</kbd> 补全
        <kbd>Enter</kbd> 选中
        <kbd>Esc</kbd> 关闭
      </div>
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isGroupConversation = props.conversationMode === "group";
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar:
      resolveAgentAvatarUrl({
        identity: {
          avatar: props.assistantAvatar ?? undefined,
          avatarUrl: props.assistantAvatarUrl ?? undefined,
        },
      }) ?? null,
    avatarText: props.assistantAvatarText?.trim() || props.assistantName.charAt(0).toUpperCase(),
    avatarColor: props.assistantAvatarColor?.trim() || "var(--accent)",
  };
  const pinned = getPinnedMessages(props.sessionKey);
  const deleted = getDeletedMessages(props.sessionKey);
  const inputHistory = getInputHistory(props.sessionKey);
  const tokens = tokenEstimate(props.draft);

  const placeholder = props.connected
    ? (props.inputPlaceholder ??
      // Fix: 问题6 - 输入框 placeholder 改成简短中文文案，发送快捷键仍保留原有逻辑。
      "输入消息…")
    : "连接 Gateway 后开始聊天…";

  const requestUpdate = props.onRequestUpdate ?? (() => {});
  const getDraft = props.getDraft ?? (() => props.draft);

  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);

  const handleCodeBlockCopy = (e: Event) => {
    const btn = (e.target as HTMLElement).closest(".code-block-copy");
    if (!btn) {
      return;
    }
    const code = (btn as HTMLElement).dataset.code ?? "";
    navigator.clipboard.writeText(code).then(
      () => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      },
      () => {},
    );
  };

  const chatItems = buildChatItems(props);
  const isNewSessionLoading = props.newSessionLoading === true;
  const quickActionDisabled =
    Boolean(props.quickActionDisabled) ||
    !props.connected ||
    props.loading ||
    isNewSessionLoading ||
    isBusy;
  const isEmpty = chatItems.length === 0 && !props.loading && !isNewSessionLoading;

  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
      @click=${handleCodeBlockCopy}
    >
      <div class="chat-thread-inner">
      ${
        props.loading && !isNewSessionLoading
          ? html`
              <div class="chat-loading-skeleton" aria-label="Loading chat">
                <div class="chat-line assistant">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div class="skeleton skeleton-line skeleton-line--long" style="margin-bottom: 8px"></div>
                      <div class="skeleton skeleton-line skeleton-line--medium" style="margin-bottom: 8px"></div>
                      <div class="skeleton skeleton-line skeleton-line--short"></div>
                    </div>
                  </div>
                </div>
                <div class="chat-line user" style="margin-top: 12px">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div class="skeleton skeleton-line skeleton-line--medium"></div>
                    </div>
                  </div>
                </div>
                <div class="chat-line assistant" style="margin-top: 12px">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div class="skeleton skeleton-line skeleton-line--long" style="margin-bottom: 8px"></div>
                      <div class="skeleton skeleton-line skeleton-line--short"></div>
                    </div>
                  </div>
                </div>
              </div>
            `
          : nothing
      }
      ${
        isNewSessionLoading
          ? html`
              <div class="chat-new-session-loading" role="status" aria-live="polite">
                <div class="chat-new-session-loading__dots" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div class="chat-new-session-loading__label">正在唤醒助手…</div>
              </div>
            `
          : nothing
      }
      ${isEmpty && !vs.searchOpen ? renderWelcomeState(props) : nothing}
      ${
        isEmpty && vs.searchOpen
          ? html`
              <div class="agent-chat__empty">没有找到匹配消息</div>
            `
          : nothing
      }
      ${repeat(
        chatItems,
        (item) => item.key,
        (item) => {
          if (item.kind === "divider") {
            return html`
              <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                <span class="chat-divider__line"></span>
                <span class="chat-divider__label">${item.label}</span>
                <span class="chat-divider__line"></span>
              </div>
            `;
          }
          if (item.kind === "reading-indicator") {
            return renderReadingIndicatorGroup(
              assistantIdentity,
              props.basePath,
              props.onAssistantAvatarClick,
            );
          }
          if (item.kind === "stream") {
            return renderStreamingGroup(
              item.text,
              item.startedAt,
              props.onOpenSidebar,
              assistantIdentity,
              props.basePath,
              props.onAssistantAvatarClick,
            );
          }
          if (item.kind === "group") {
            if (deleted.has(item.key)) {
              return nothing;
            }
            return renderMessageGroup(item, {
              onOpenSidebar: props.onOpenSidebar,
              showReasoning,
              textDecorator: props.messageTextDecorator,
              assistantName: props.assistantName,
              assistantAvatar: assistantIdentity.avatar,
              assistantAvatarText: assistantIdentity.avatarText,
              assistantAvatarColor: assistantIdentity.avatarColor,
              assistantAgentId: props.assistantAgentId ?? null,
              userAvatar: props.userAvatar ?? null,
              userName: props.userName ?? null,
              onUserAvatarClick: props.onUserAvatarClick,
              onAssistantAvatarClick: props.onAssistantAvatarClick,
              basePath: props.basePath,
              contextWindow:
                activeSession?.contextTokens ?? props.sessions?.defaults?.contextTokens ?? null,
              onDelete: () => {
                deleted.delete(item.key);
                requestUpdate();
              },
            });
          }
          return nothing;
        },
      )}
      </div>
    </div>
  `;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (vs.commandPaletteOpen) {
      const items = getSlashCommandCompletions(vs.commandPaletteQuery);
      if (items.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeCommandPalette(requestUpdate);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.commandPaletteIndex = (vs.commandPaletteIndex + 1) % items.length;
          requestUpdate();
          scrollActivePaletteItemIntoView();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.commandPaletteIndex = (vs.commandPaletteIndex - 1 + items.length) % items.length;
          requestUpdate();
          scrollActivePaletteItemIntoView();
          return;
        case "Enter": {
          e.preventDefault();
          const activeIndex = Math.min(vs.commandPaletteIndex, items.length - 1);
          selectCommandPaletteItem(items[activeIndex], props, requestUpdate);
          return;
        }
        case "Escape":
          e.preventDefault();
          closeCommandPalette(requestUpdate);
          return;
      }
    }

    // Slash menu navigation — arg mode
    if (vs.slashMenuOpen && vs.slashMenuMode === "args" && vs.slashMenuArgItems.length > 0) {
      const len = vs.slashMenuArgItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, false);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, true);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Slash menu navigation — command mode
    if (vs.slashMenuOpen && vs.slashMenuItems.length > 0) {
      const len = vs.slashMenuItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          tabCompleteSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Input history (only when input is empty)
    if (!props.draft.trim()) {
      if (e.key === "ArrowUp") {
        const prev = inputHistory.up();
        if (prev !== null) {
          e.preventDefault();
          props.onDraftChange(prev);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        const next = inputHistory.down();
        e.preventDefault();
        props.onDraftChange(next ?? "");
        return;
      }
    }

    // Fix: 问题1 - 支持和顶部搜索提示一致的 Cmd/Ctrl + K，并在展开后自动聚焦搜索栏。
    if (isChatSearchShortcut(e)) {
      e.preventDefault();
      const isSearchOpen = toggleChatSearch();
      if (isSearchOpen) {
        focusVisibleChatSearchInput();
      }
      requestUpdate();
      return;
    }

    // Send on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (!props.connected) {
        return;
      }
      e.preventDefault();
      if (canCompose) {
        if (props.draft.trim()) {
          inputHistory.push(props.draft);
        }
        props.onSend();
      }
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    adjustTextareaHeight(target);
    updateSlashMenu(target.value, requestUpdate);
    inputHistory.reset();
    props.onDraftChange(target.value, target.selectionStart ?? target.value.length);
  };

  return html`
    <section
      class="card chat"
      @drop=${(e: DragEvent) => handleDrop(e, props)}
      @dragover=${(e: DragEvent) => e.preventDefault()}
    >
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        props.focusMode
          ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              ${icons.x}
            </button>
          `
          : nothing
      }

      ${renderCommandPalette(requestUpdate, props)}
      ${renderSearchBar(requestUpdate)}
      ${renderPinnedSection(props, pinned, requestUpdate)}

      <div class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}">
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${
          sidebarOpen
            ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
            : nothing
        }
      </div>

      ${
        props.queue.length
          ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__title">Queued (${props.queue.length})</div>
              <div class="chat-queue__list">
                ${props.queue.map(
                  (item) => html`
                    <div class="chat-queue__item">
                      <div class="chat-queue__text">
                        ${
                          item.text ||
                          (item.attachments?.length ? `Image (${item.attachments.length})` : "")
                        }
                      </div>
                      <button
                        class="btn chat-queue__remove"
                        type="button"
                        aria-label="Remove queued message"
                        @click=${() => props.onQueueRemove(item.id)}
                      >
                        ${icons.x}
                      </button>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      ${renderFallbackIndicator(props.fallbackStatus)}
      ${renderCompactionIndicator(props.compactionStatus)}
      ${renderContextNotice(activeSession, props.sessions?.defaults?.contextTokens ?? null)}

      ${
        props.showNewMessages
          ? html`
            <button
              class="chat-new-messages"
              type="button"
              @click=${props.onScrollToBottom}
            >
              ${icons.arrowDown} New messages
            </button>
          `
          : nothing
      }

      <!-- Input bar -->
      <div class="agent-chat__input">
        ${renderQuickActions({ ...props, quickActionDisabled })}
        ${renderSlashMenu(requestUpdate, props)}
        ${props.groupCompose ? renderGroupMentionPopover(props.groupCompose) : nothing}
        ${renderAttachmentPreview(props)}

        <input
          type="file"
          accept=${CHAT_ATTACHMENT_ACCEPT}
          multiple
          class="agent-chat__file-input"
          @change=${(e: Event) => handleFileSelect(e, props)}
        />

        ${vs.sttRecording && vs.sttInterimText ? html`<div class="agent-chat__stt-interim">${vs.sttInterimText}</div>` : nothing}

        <div class="agent-chat__textarea-wrap">
          <textarea
            ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
            class="agent-chat__textarea"
            .value=${props.draft}
            dir=${detectTextDirection(props.draft)}
            ?disabled=${!props.connected}
            @keydown=${handleKeyDown}
            @input=${handleInput}
            @focus=${() => {
              props.onDraftFocusChange?.(true);
            }}
            @blur=${() => {
              props.onDraftFocusChange?.(false);
            }}
            @select=${(event: Event) => {
              props.onDraftSelectionChange?.(
                (event.target as HTMLTextAreaElement).selectionStart ?? props.draft.length,
              );
            }}
            @click=${(event: Event) => {
              props.onDraftSelectionChange?.(
                (event.target as HTMLTextAreaElement).selectionStart ?? props.draft.length,
              );
            }}
            @keyup=${(event: Event) => {
              props.onDraftSelectionChange?.(
                (event.target as HTMLTextAreaElement).selectionStart ?? props.draft.length,
              );
            }}
            @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
            placeholder=${vs.sttRecording ? "Listening..." : placeholder}
            rows="1"
          ></textarea>
        </div>

        <div class="agent-chat__toolbar">
          <div class="agent-chat__toolbar-left">
            ${
              props.hideAttachmentButton
                ? nothing
                : html`
                    <button
                      class="agent-chat__input-btn"
                      @click=${() => {
                        document
                          .querySelector<HTMLInputElement>(".agent-chat__file-input")
                          ?.click();
                      }}
                      title="Attach file"
                      ?disabled=${!props.connected}
                    >
                      ${icons.paperclip}
                    </button>
                  `
            }

            ${
              isSttSupported()
                ? html`
                  <button
                    class="agent-chat__input-btn ${vs.sttRecording ? "agent-chat__input-btn--recording" : ""}"
                    @click=${() => {
                      if (vs.sttRecording) {
                        stopStt();
                        vs.sttRecording = false;
                        vs.sttInterimText = "";
                        requestUpdate();
                      } else {
                        const started = startStt({
                          onTranscript: (text, isFinal) => {
                            if (isFinal) {
                              const current = getDraft();
                              const sep = current && !current.endsWith(" ") ? " " : "";
                              props.onDraftChange(current + sep + text);
                              vs.sttInterimText = "";
                            } else {
                              vs.sttInterimText = text;
                            }
                            requestUpdate();
                          },
                          onStart: () => {
                            vs.sttRecording = true;
                            requestUpdate();
                          },
                          onEnd: () => {
                            vs.sttRecording = false;
                            vs.sttInterimText = "";
                            requestUpdate();
                          },
                          onError: () => {
                            vs.sttRecording = false;
                            vs.sttInterimText = "";
                            requestUpdate();
                          },
                        });
                        if (started) {
                          vs.sttRecording = true;
                          requestUpdate();
                        }
                      }
                    }}
                    title=${vs.sttRecording ? "Stop recording" : "Voice input"}
                    ?disabled=${!props.connected}
                  >
                    ${vs.sttRecording ? icons.micOff : icons.mic}
                  </button>
                `
                : nothing
            }

            ${props.groupCompose ? renderGroupQuickMentions(props.groupCompose) : nothing}
            ${tokens ? html`<span class="agent-chat__token-count">${tokens}</span>` : nothing}
          </div>

          <div class="agent-chat__toolbar-right">
            ${nothing /* search hidden for now */}
            ${
              canAbort || isGroupConversation
                ? nothing
                : html`
                    <button
                      class="btn-ghost"
                      @click=${props.onNewSession}
                      title="New session"
                      aria-label="New session"
                    >
                      ${icons.plus}
                    </button>
                  `
            }
            ${
              isGroupConversation
                ? nothing
                : html`
                    <button
                      class="btn-ghost"
                      @click=${() => exportMarkdown(props)}
                      title="导出 Markdown"
                      ?disabled=${props.messages.length === 0}
                    >
                      ${icons.download}
                    </button>
                  `
            }

            ${
              canAbort && (isBusy || props.sending)
                ? html`
                  <button class="chat-send-btn chat-send-btn--stop" @click=${props.onAbort} title="Stop">
                    ${icons.stop}
                  </button>
                `
                : html`
                  <button
                    class="chat-send-btn"
                    @click=${() => {
                      if (props.draft.trim()) {
                        inputHistory.push(props.draft);
                      }
                      props.onSend();
                    }}
                    ?disabled=${!props.connected || props.sending}
                    title=${isBusy ? "Queue" : "Send"}
                  >
                    ${icons.send}
                  </button>
                `
            }
          </div>
        </div>

      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

export function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel = normalized.senderLabel ?? null;
    const senderId = normalized.senderId ?? null;
    const senderAvatarUrl = normalized.senderAvatarUrl ?? null;
    const senderAvatarText = normalized.senderAvatarText ?? null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      currentGroup.senderLabel !== senderLabel ||
      currentGroup.senderId !== senderId
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        senderId,
        senderAvatarUrl,
        senderAvatarText,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "divider",
      key: "chat:history:notice",
      label: `更早的 ${historyStart} 条消息已折叠`,
      timestamp: Date.now(),
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    if (shouldHideSystemToolMessage(msg)) {
      continue;
    }
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showThinking && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    // Apply search filter if active
    if (vs.searchOpen && vs.searchQuery.trim() && !messageMatchesSearchQuery(msg, vs.searchQuery)) {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  // Interleave stream segments and tool cards in order. Each segment
  // contains text that was streaming before the corresponding tool started.
  // This ensures correct visual ordering: text → tool → text → tool → ...
  const segments = props.streamSegments ?? [];
  const maxLen = Math.max(segments.length, tools.length);
  for (let i = 0; i < maxLen; i++) {
    if (
      i < segments.length &&
      segments[i].text.trim().length > 0 &&
      !shouldHideSystemToolStreamText(segments[i].text)
    ) {
      items.push({
        kind: "stream" as const,
        key: `stream-seg:${props.sessionKey}:${i}`,
        text: segments[i].text,
        startedAt: segments[i].ts,
      });
    }
    if (i < tools.length && !shouldHideSystemToolMessage(tools[i])) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0 && !shouldHideSystemToolStreamText(props.stream)) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
