// 复制自 openclaw 3.13 原版 ui/src/ui/app-render.ts、ui/src/ui/app-render.helpers.ts，用于二开定制

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "./icons.ts";
import type { SessionsListResult } from "./types.ts";

export type ChatShellThemeMode = "system" | "light" | "dark";

type ChatModelOption = {
  value: string;
  label: string;
};

type ChatMemberOption = {
  id: string;
  name: string;
};

type ChatGroupOption = {
  id: string;
  name: string;
};

type ChatGroupHeaderMember = {
  id: string;
  name: string;
  avatarText: string;
  avatarUrl?: string | null;
};

type ChatGroupHeader = {
  name: string;
  avatarText: string;
  avatarUrl?: string | null;
  members: ChatGroupHeaderMember[];
  memberCount: number;
};

type ChatCronHint = {
  count: number;
  tooltip: string;
};

type ChatShellProps = {
  activeAgentId: string;
  assistantName: string;
  headerTitle: string;
  healthAlertSymbol?: string | null;
  healthAlertTitle?: string | null;
  agentNamesById?: Record<string, string>;
  members: ChatMemberOption[];
  groups: ChatGroupOption[];
  currentGroupId?: string | null;
  isGroupMode?: boolean;
  groupHeader?: ChatGroupHeader | null;
  onGroupHeaderMemberClick?: (memberId: string) => void;
  hasAnnouncement?: boolean;
  isUrging?: boolean;
  isUrgePaused?: boolean;
  notificationsEnabled?: boolean;
  soundEnabled?: boolean;
  connected: boolean;
  loading: boolean;
  sending: boolean;
  busy: boolean;
  themeMode: ChatShellThemeMode;
  error: string | null;
  showThinking: boolean;
  focusMode: boolean;
  hideCronSessions: boolean;
  hiddenCronCount: number;
  directCronHint?: ChatCronHint | null;
  groupCronHint?: ChatCronHint | null;
  sessions: SessionsListResult | null;
  sessionKey: string;
  modelValue: string;
  defaultModelValue: string;
  modelOptions: ChatModelOption[];
  modelsLoading: boolean;
  onToggleSearch: () => void;
  onThemeModeChange: (mode: ChatShellThemeMode) => void;
  onMemberSelect: (agentId: string) => void;
  onGroupSelect: (groupId: string) => void;
  onSessionSelect: (sessionKey: string) => void;
  onModelSelect: (model: string) => void;
  onAnnouncementClick?: () => void;
  onUrgeClick?: () => void;
  onToggleNotifications?: () => void;
  onToggleSound?: () => void;
  onEditGroupClick?: () => void;
  onManageMembersClick?: () => void;
  onArchiveConversationClick?: () => void;
  onResetConversationClick?: () => void;
  onDissolveGroupClick?: () => void;
  onDirectCronClick?: () => void;
  onGroupCronClick?: () => void;
  onRefresh: () => void;
  onToggleThinking: () => void;
  onToggleFocusMode: () => void;
  onToggleHideCronSessions: () => void;
  body: TemplateResult;
};

const THEME_MODE_OPTIONS: Array<{ id: ChatShellThemeMode; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const STACK_AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function resolveStackAvatarColor(id: string) {
  return STACK_AVATAR_COLORS[hashText(id) % STACK_AVATAR_COLORS.length];
}

function renderGroupIdentityFallback(
  item: Pick<ChatGroupHeader, "avatarText" | "avatarUrl" | "name"> | ChatGroupHeaderMember,
  className: string,
) {
  const avatarKey = "id" in item ? item.id : item.name;

  if (!("id" in item)) {
    return html`
      <div class=${className} style="background:linear-gradient(135deg, var(--accent-2), var(--accent));" aria-label=${item.name}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      </div>
    `;
  }

  return html`
    <div
      class=${className}
      style=${`background:${resolveStackAvatarColor(avatarKey)};`}
      aria-label=${item.name}
    >
      ${item.avatarText}
    </div>
  `;
}

function renderTopbarThemeModeToggle(props: ChatShellProps) {
  const modeIcon = (mode: ChatShellThemeMode) => {
    if (mode === "system") {
      return icons.monitor;
    }
    if (mode === "light") {
      return icons.sun;
    }
    return icons.moon;
  };

  return html`
    <div class="topbar-theme-mode" role="group" aria-label="Color mode">
      ${THEME_MODE_OPTIONS.map(
        (option) => html`
          <button
            type="button"
            class="topbar-theme-mode__btn ${
              option.id === props.themeMode ? "topbar-theme-mode__btn--active" : ""
            }"
            title=${option.label}
            aria-label="Color mode: ${option.label}"
            aria-pressed=${option.id === props.themeMode}
            @click=${() => props.onThemeModeChange(option.id)}
          >
            ${modeIcon(option.id)}
          </button>
        `,
      )}
    </div>
  `;
}

function renderGroupIdentityAvatar(
  item: Pick<ChatGroupHeader, "avatarText" | "avatarUrl" | "name"> | ChatGroupHeaderMember,
  className: string,
  onClick?: (target: HTMLElement) => void,
) {
  const clickable = "id" in item && Boolean(onClick);
  const label = "id" in item ? `编辑 ${item.name} 的资料` : item.name;

  if (!item.avatarUrl?.trim() && clickable) {
    return html`
      <button
        type="button"
        class="surface-group-topbar__avatar-btn"
        aria-label=${label}
        title=${label}
        @click=${(event: Event) => {
          onClick?.(event.currentTarget as HTMLElement);
        }}
      >
        ${renderGroupIdentityFallback(item, className)}
      </button>
    `;
  }

  if (!item.avatarUrl?.trim()) {
    return renderGroupIdentityFallback(item, className);
  }

  if (clickable) {
    return html`
      <button
        type="button"
        class="surface-group-topbar__avatar-btn"
        aria-label=${label}
        title=${label}
        @click=${(event: Event) => {
          onClick?.(event.currentTarget as HTMLElement);
        }}
      >
        <div class="surface-group-identity-avatar">
          <div class="surface-group-identity-avatar__fallback" aria-hidden="true">
            ${renderGroupIdentityFallback(item, className)}
          </div>
          <img
            class="${className} surface-group-identity-avatar__image"
            src=${item.avatarUrl}
            alt=${item.name}
            @error=${(event: Event) => {
              const image = event.currentTarget as HTMLImageElement;
              image.hidden = true;
              const fallback = image.previousElementSibling as HTMLElement | null;
              if (!fallback) {
                return;
              }
              fallback.removeAttribute("aria-hidden");
            }}
          />
        </div>
      </button>
    `;
  }

  return html`
    <div class="surface-group-identity-avatar">
      <div class="surface-group-identity-avatar__fallback" aria-hidden="true">
        ${renderGroupIdentityFallback(item, className)}
      </div>
      <img
        class="${className} surface-group-identity-avatar__image"
        src=${item.avatarUrl}
        alt=${item.name}
        @error=${(event: Event) => {
          const image = event.currentTarget as HTMLImageElement;
          image.hidden = true;
          const fallback = image.previousElementSibling as HTMLElement | null;
          if (!fallback) {
            return;
          }
          fallback.removeAttribute("aria-hidden");
        }}
      />
    </div>
  `;
}

function renderGroupTopbar(props: ChatShellProps) {
  const header = props.groupHeader;
  if (!props.isGroupMode || !header) {
    return html`
      <div class="dashboard-header">
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <div class="dashboard-header__title" title=${props.headerTitle}>
            ${props.headerTitle}
          </div>
          ${
            props.healthAlertSymbol && props.healthAlertTitle
              ? html`<span
                  class="dashboard-header__health"
                  title=${props.healthAlertTitle}
                  aria-label=${props.healthAlertTitle}
                >
                  ${props.healthAlertSymbol}
                </span>`
              : nothing
          }
          ${
            props.directCronHint
              ? html`
                  <button
                    class="btn btn--sm btn--icon"
                    type="button"
                    title=${props.directCronHint.tooltip}
                    aria-label=${props.directCronHint.tooltip}
                    @click=${props.onDirectCronClick}
                  >
                    <span style="font-size:15px; line-height:1;">📅</span>
                  </button>
                `
              : nothing
          }
        </div>
      </div>
    `;
  }

  const visibleMembers = header.members.slice(0, 4);
  const stackWidth = 24 + Math.max(0, visibleMembers.length - 1) * 16;

  return html`
    <div class="surface-group-topbar" title=${header.name}>
      <div class="surface-group-topbar__main">
        <div class="surface-group-topbar__avatar-wrap">
          ${renderGroupIdentityAvatar(header, "surface-group-topbar__avatar")}
        </div>
        <div
          class="surface-group-topbar__identity"
          style="position:relative; min-height:32px; padding-right:48px;"
        >
          <div class="surface-group-topbar__title-row">
            <div class="surface-group-topbar__name">${header.name}</div>
            <div class="surface-group-topbar__members" aria-label="项目组成员">
              <div
                class="surface-group-topbar__stack"
                style=${`--group-stack-width:${stackWidth}px;`}
              >
                ${visibleMembers.map(
                  (member, index) => html`
                    <div
                      class="surface-group-topbar__stack-item"
                      style=${`--group-member-offset:${index * 16}px; z-index:${20 - index};`}
                    >
                      ${renderGroupIdentityAvatar(
                        member,
                        "surface-group-topbar__member-avatar",
                        () => {
                          props.onGroupHeaderMemberClick?.(member.id);
                        },
                      )}
                    </div>
                  `,
                )}
              </div>
              <span class="surface-group-topbar__count">(${header.memberCount}人)</span>
            </div>
          </div>
          ${renderGroupMoreMenu(props, "position:absolute; right:0; top:50%; transform:translateY(-50%); z-index:4;")}
        </div>
      </div>
    </div>
  `;
}

function renderModelSelect(props: ChatShellProps) {
  return html`
    <label class="field chat-controls__dropdown">
      <select
        data-chat-model-select="true"
        aria-label="选择模型"
        ?disabled=${!props.connected || props.busy || (props.modelsLoading && props.modelOptions.length === 0)}
        @change=${(event: Event) => {
          props.onModelSelect((event.target as HTMLSelectElement).value.trim());
        }}
      >
        <option value="" ?selected=${props.modelValue === ""}>选择模型</option>
        ${props.modelOptions.map(
          (option) => html`
            <option value=${option.value} ?selected=${option.value === props.modelValue}>
              ${option.label}
            </option>
          `,
        )}
      </select>
    </label>
  `;
}

function renderMemberSelect(props: ChatShellProps) {
  const defaultLabel = props.isGroupMode ? "私聊成员" : "切换成员";
  return html`
    <label class="field chat-controls__dropdown">
      <select
        data-chat-member-select="true"
        aria-label="切换成员"
        .value=${""}
        ?disabled=${props.members.length === 0}
        @change=${(event: Event) => {
          const select = event.target as HTMLSelectElement;
          const next = select.value.trim();
          if (!next) {
            return;
          }
          props.onMemberSelect(next);
          select.value = "";
        }}
      >
        <option value="" selected>${defaultLabel}</option>
        ${props.members.map(
          (member) => html`
            <option value=${member.id}>${member.name}</option>
          `,
        )}
      </select>
    </label>
  `;
}

function renderGroupSelect(props: ChatShellProps) {
  const defaultLabel = props.isGroupMode ? "切换项目组" : "选择项目组";
  return html`
    <label class="field chat-controls__dropdown">
      <select
        data-chat-group-select="true"
        aria-label="选择项目组"
        .value=${""}
        ?disabled=${props.groups.length === 0}
        @change=${(event: Event) => {
          const select = event.target as HTMLSelectElement;
          const next = select.value.trim();
          if (!next) {
            return;
          }
          props.onGroupSelect(next);
          select.value = "";
        }}
      >
        <option value="" selected>${defaultLabel}</option>
        ${props.groups.map(
          (group) => html`
            <option value=${group.id}>${group.name}</option>
          `,
        )}
      </select>
    </label>
  `;
}

function renderTopbarSelects(props: ChatShellProps) {
  return html`
    <div class="chat-controls__session-row ${props.isGroupMode ? "chat-controls__session-row--group" : ""}">
      ${/* GroupChat: 问题3 - 群聊只保留成员/项目组两个下拉框并保持同一行等宽排列。 */ nothing}
      ${renderMemberSelect(props)}
      ${renderGroupSelect(props)}
      ${props.isGroupMode ? nothing : renderModelSelect(props)}
    </div>
  `;
}

function renderCronFilterIcon(hiddenCount: number) {
  return html`
    <span style="position: relative; display: inline-flex; align-items: center;">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${
        hiddenCount > 0
          ? html`<span
              style="
                position: absolute;
                top: -5px;
                right: -6px;
                background: var(--accent);
                color: var(--text-inverse);
                border-radius: 999px;
                font-size: 9px;
                line-height: 1;
                padding: 1px 3px;
                pointer-events: none;
              "
            >${hiddenCount}</span>`
          : nothing
      }
    </span>
  `;
}

let activeGroupMenuCleanup: (() => void) | null = null;

function cleanupGroupMenuListeners() {
  activeGroupMenuCleanup?.();
  activeGroupMenuCleanup = null;
}

function resolveGroupMenuRoot(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-surface-group-more="true"]')
    : null;
}

function setGroupMenuOpen(root: HTMLElement, open: boolean) {
  const trigger = root.querySelector<HTMLElement>('[data-surface-group-more-trigger="true"]');
  if (!open) {
    cleanupGroupMenuListeners();
    root.dataset.open = "false";
    trigger?.setAttribute("aria-expanded", "false");
    return;
  }

  cleanupGroupMenuListeners();
  root.dataset.open = "true";
  trigger?.setAttribute("aria-expanded", "true");

  const closeMenu = () => {
    root.dataset.open = "false";
    trigger?.setAttribute("aria-expanded", "false");
    cleanupGroupMenuListeners();
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && root.contains(target)) {
      return;
    }

    closeMenu();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    closeMenu();
    trigger?.focus();
  };

  const timerId = window.setTimeout(() => {
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
  }, 0);

  const cleanup = () => {
    window.clearTimeout(timerId);
    document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("keydown", handleKeyDown);
    if (activeGroupMenuCleanup === cleanup) {
      activeGroupMenuCleanup = null;
    }
  };

  activeGroupMenuCleanup = cleanup;
}

function toggleGroupMenu(trigger: HTMLElement) {
  const root = resolveGroupMenuRoot(trigger);
  if (!root) {
    return;
  }

  const isOpen = root.dataset.open === "true";
  setGroupMenuOpen(root, !isOpen);
}

function closeGroupMenu(target: EventTarget | null) {
  const root = resolveGroupMenuRoot(target);
  if (!root) {
    return;
  }

  setGroupMenuOpen(root, false);
}

function renderGroupMenuTriggerIcon() {
  return html`
    <span class="surface-group-more__kebab" aria-hidden="true">
      <span class="surface-group-more__dot"></span>
      <span class="surface-group-more__dot"></span>
      <span class="surface-group-more__dot"></span>
    </span>
  `;
}

function renderNotificationMenuIcon(enabled: boolean) {
  return html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 0 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      ${
        enabled
          ? nothing
          : html`
              <path d="M4 4l16 16" />
            `
      }
    </svg>
  `;
}

function renderMembersMenuIcon() {
  return html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3.5" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16.5 3.13a3.5 3.5 0 0 1 0 6.74" />
    </svg>
  `;
}

function renderResetMenuIcon() {
  return html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.71" />
      <path d="M3 4v5h5" />
    </svg>
  `;
}

function renderGroupMoreMenu(props: ChatShellProps, rootStyle = "") {
  const notificationsEnabled = props.notificationsEnabled !== false;
  const soundEnabled = props.soundEnabled !== false;
  const notificationLabel = notificationsEnabled ? "关闭消息提醒" : "开启消息提醒";
  const soundLabel = soundEnabled ? "关闭音效" : "开启音效";
  const menuStyle =
    props.themeMode === "dark"
      ? "top:calc(100% + 8px); right:0; z-index:9999; background:#1a1520; color:#fff; box-shadow:0 4px 12px rgba(0,0,0,0.15);"
      : "top:calc(100% + 8px); right:0; z-index:9999; background:#fff; color:#333; box-shadow:0 4px 12px rgba(0,0,0,0.15);";

  return html`
    <div
      class="surface-group-more"
      data-surface-group-more="true"
      data-open="false"
      style=${rootStyle}
    >
      <button
        class="btn btn--sm btn--icon surface-group-more__trigger"
        type="button"
        data-surface-group-more-trigger="true"
        aria-label="更多操作"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded="false"
        @click=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleGroupMenu(event.currentTarget as HTMLElement);
        }}
      >
        ${renderGroupMenuTriggerIcon()}
      </button>
      <div
        class="surface-group-more__menu"
        role="menu"
        aria-label="群聊更多操作"
        style=${menuStyle}
      >
        <button
          class="surface-group-more__item"
          type="button"
          role="menuitem"
          ?disabled=${!props.onToggleNotifications}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onToggleNotifications?.();
          }}
        >
          <span class="surface-group-more__item-icon">${renderNotificationMenuIcon(notificationsEnabled)}</span>
          <span class="surface-group-more__item-label">${notificationLabel}</span>
        </button>
        <button
          class="surface-group-more__item"
          type="button"
          role="menuitem"
          ?disabled=${!props.onToggleSound}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onToggleSound?.();
          }}
        >
          <span class="surface-group-more__item-icon">${soundEnabled ? icons.volumeOff : icons.volume2}</span>
          <span class="surface-group-more__item-label">${soundLabel}</span>
        </button>
        <button
          class="surface-group-more__item"
          type="button"
          role="menuitem"
          ?disabled=${!props.onEditGroupClick}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onEditGroupClick?.();
          }}
        >
          <span class="surface-group-more__item-icon">${icons.penLine}</span>
          <span class="surface-group-more__item-label">编辑项目组</span>
        </button>
        <button
          class="surface-group-more__item"
          type="button"
          role="menuitem"
          ?disabled=${!props.onManageMembersClick}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onManageMembersClick?.();
          }}
        >
          <span class="surface-group-more__item-icon">${renderMembersMenuIcon()}</span>
          <span class="surface-group-more__item-label">成员管理</span>
        </button>
        <button
          class="surface-group-more__item surface-group-more__item--danger"
          type="button"
          role="menuitem"
          ?disabled=${!props.onResetConversationClick}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onResetConversationClick?.();
          }}
        >
          <span class="surface-group-more__item-icon">${renderResetMenuIcon()}</span>
          <span class="surface-group-more__item-label">重置对话</span>
        </button>
        <div class="surface-group-more__separator" role="separator" aria-hidden="true"></div>
        <button
          class="surface-group-more__item surface-group-more__item--destructive"
          type="button"
          role="menuitem"
          ?disabled=${!props.onDissolveGroupClick}
          @click=${(event: Event) => {
            closeGroupMenu(event.currentTarget);
            props.onDissolveGroupClick?.();
          }}
        >
          <span class="surface-group-more__item-icon surface-group-more__item-icon--emoji">🗑</span>
          <span class="surface-group-more__item-label">解散群聊</span>
        </button>
      </div>
    </div>
  `;
}

function renderChatControls(props: ChatShellProps) {
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  const archiveIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"></path>
      <path d="M23 3H1v5h22z"></path>
      <path d="M10 12h4"></path>
    </svg>
  `;

  if (props.isGroupMode) {
    const announcementIcon = html`
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 10v4"></path>
        <path d="M10 6l8-3v18l-8-3H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4z"></path>
        <path d="M10 16v4a2 2 0 0 0 2 2h1"></path>
      </svg>
    `;
    const urgeIcon = html`
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"></path>
      </svg>
    `;
    const themeIcon =
      props.themeMode === "dark"
        ? icons.sun
        : props.themeMode === "light"
          ? icons.moon
          : icons.monitor;
    const urgeLabel = props.isUrging ? (props.isUrgePaused ? "已暂停" : "督促中") : "督促模式";

    return html`
      <div class="chat-controls chat-controls--group">
        ${/* GroupChat: 问题4 - 群聊顶部补回群公告和督促模式入口，并让视觉层级高于普通图标按钮。 */ nothing}
        <button
          class="surface-chat-pill surface-chat-pill--announcement ${props.hasAnnouncement ? "surface-chat-pill--active" : ""}"
          type="button"
          @click=${props.onAnnouncementClick}
        >
          ${announcementIcon}
          <span>群公告</span>
        </button>
        <button
          class="surface-chat-pill surface-chat-pill--urge ${props.isUrging ? "surface-chat-pill--active" : ""}"
          type="button"
          @click=${props.onUrgeClick}
        >
          ${urgeIcon}
          <span>${urgeLabel}</span>
        </button>
        <button
          class="btn btn--sm btn--icon"
          type="button"
          title=${props.groupCronHint?.tooltip || "管理当前群聊的定时任务"}
          aria-label=${props.groupCronHint?.tooltip || "管理当前群聊的定时任务"}
          @click=${props.onGroupCronClick}
        >
          <span style="font-size:15px; line-height:1; position:relative; display:inline-flex; align-items:center;">
            ⏰
            ${
              (props.groupCronHint?.count ?? 0) > 0
                ? html`
                    <span
                      style="
                        position:absolute;
                        top:-6px;
                        right:-10px;
                        min-width:14px;
                        height:14px;
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        border-radius:999px;
                        background:var(--accent);
                        color:var(--text-inverse);
                        font-size:9px;
                        line-height:1;
                        padding:0 4px;
                      "
                    >${props.groupCronHint?.count}</span>
                  `
                : nothing
            }
          </span>
        </button>
        <button
          class="btn btn--sm btn--icon"
          type="button"
          ?disabled=${props.loading || props.sending || !props.connected}
          title="刷新聊天数据"
          aria-label="刷新聊天数据"
          @click=${props.onRefresh}
        >
          ${refreshIcon}
        </button>
        <button
          class="btn btn--sm btn--icon ${props.focusMode ? "active" : ""}"
          type="button"
          aria-pressed=${props.focusMode}
          title="切换专注模式 (隐藏侧边栏 + 页面页眉)"
          @click=${props.onToggleFocusMode}
        >
          ${focusIcon}
        </button>
        <button
          class="btn btn--sm btn--icon"
          type="button"
          title="切换明暗主题"
          aria-label="切换明暗主题"
          @click=${() => {
            props.onThemeModeChange(props.themeMode === "dark" ? "light" : "dark");
          }}
        >
          ${themeIcon}
        </button>
        <button
          class="btn btn--sm btn--icon ${props.hideCronSessions ? "active" : ""}"
          type="button"
          aria-pressed=${props.hideCronSessions}
          title=${
            props.hideCronSessions
              ? props.hiddenCronCount > 0
                ? `显示定时任务会话 (已隐藏 ${props.hiddenCronCount} 个)`
                : "显示定时任务会话"
              : "隐藏定时任务会话"
          }
          @click=${props.onToggleHideCronSessions}
        >
          ${renderCronFilterIcon(props.hiddenCronCount)}
        </button>
      </div>
    `;
  }

  return html`
    <div class="chat-controls">
      <button
        class="btn btn--sm btn--icon"
        type="button"
        ?disabled=${props.loading || props.sending || !props.connected}
        title="刷新聊天数据"
        aria-label="刷新聊天数据"
        @click=${props.onRefresh}
      >
        ${refreshIcon}
      </button>
      <button
        class="btn btn--sm btn--icon"
        type="button"
        ?disabled=${props.loading || props.sending || props.busy || !props.connected}
        title="归档当前会话"
        aria-label="归档当前会话"
        @click=${props.onArchiveConversationClick}
      >
        ${archiveIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${props.showThinking ? "active" : ""}"
        type="button"
        aria-pressed=${props.showThinking}
        title="切换助手思考/工作输出"
        @click=${props.onToggleThinking}
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${props.focusMode ? "active" : ""}"
        type="button"
        aria-pressed=${props.focusMode}
        title="切换专注模式 (隐藏侧边栏 + 页面页眉)"
        @click=${props.onToggleFocusMode}
      >
        ${focusIcon}
      </button>
      <button
        class="btn btn--sm btn--icon ${props.hideCronSessions ? "active" : ""}"
        type="button"
        aria-pressed=${props.hideCronSessions}
        title=${
          props.hideCronSessions
            ? props.hiddenCronCount > 0
              ? `显示定时任务会话 (已隐藏 ${props.hiddenCronCount} 个)`
              : "显示定时任务会话"
            : "隐藏定时任务会话"
        }
        @click=${props.onToggleHideCronSessions}
      >
        ${renderCronFilterIcon(props.hiddenCronCount)}
      </button>
    </div>
  `;
}

export function renderOriginalChatShell(props: ChatShellProps) {
  return html`
    <div class="openclaw-chat-shell ${props.focusMode ? "openclaw-chat-shell--focus" : ""}">
      <header class="topbar openclaw-chat-shell__topbar ${props.isGroupMode ? "openclaw-chat-shell__topbar--group" : ""}">
        ${/* GroupChat: 问题1、问题2 - 群聊顶部改成项目组头像/名称/成员堆叠，并移除右上角搜索位。 */ nothing}
        ${renderGroupTopbar(props)}
        ${
          props.isGroupMode
            ? nothing
            : html`<div class="topbar-status">${renderTopbarThemeModeToggle(props)}</div>`
        }
      </header>

      <main class="content content--chat openclaw-chat-shell__content">
        <section class="content-header">
          <div>${renderTopbarSelects(props)}</div>
          <div class="page-meta">
            ${/* GroupChat: 问题3、问题4 - 顶部操作区不渲染错误信息，群聊按钮和下拉框都走统一 surface。 */ nothing}
            ${renderChatControls(props)}
          </div>
        </section>

        ${props.body}
      </main>
    </div>
  `;
}
