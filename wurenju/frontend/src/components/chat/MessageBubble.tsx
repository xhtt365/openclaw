"use client";

// 复制自 openclaw 原版 ui/src/ui/chat/grouped-render.ts，用于二开定制

import { Check, Copy, Download, RefreshCw, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightPlainText, highlightReactChildren } from "@/components/chat/search-match";
import { cn } from "@/lib/utils";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import type { ChatMessage } from "@/utils/messageAdapter";
import { getUserInitial, type UserProfile } from "@/utils/userProfile";
import { openUserProfilePopover } from "@/utils/userProfilePopoverDom";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMessageTimestamp(message: ChatMessage) {
  if (message.timestampLabel?.trim()) {
    return message.timestampLabel.trim();
  }

  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return formatTimestamp(message.timestamp);
  }

  return "历史消息";
}

function StaticMarkdownText(props: {
  content: string;
  className?: string;
  highlightQuery?: string;
}) {
  return (
    <div className={cn("chat-text", props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children, ...nodeProps }) => (
            <p {...nodeProps}>{highlightReactChildren(children, props.highlightQuery ?? "")}</p>
          ),
          ul: ({ ...nodeProps }) => <ul {...nodeProps} />,
          ol: ({ ...nodeProps }) => <ol {...nodeProps} />,
          li: ({ children, ...nodeProps }) => (
            <li {...nodeProps}>{highlightReactChildren(children, props.highlightQuery ?? "")}</li>
          ),
          a: ({ children, ...nodeProps }) => (
            <a {...nodeProps} rel="noreferrer noopener" target="_blank">
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </a>
          ),
          pre: ({ children, ...nodeProps }) => (
            <pre {...nodeProps}>{highlightReactChildren(children, props.highlightQuery ?? "")}</pre>
          ),
          code: ({ children, ...nodeProps }) => (
            <code {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </code>
          ),
          strong: ({ children, ...nodeProps }) => (
            <strong {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </strong>
          ),
          blockquote: ({ children, ...nodeProps }) => (
            <blockquote {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </blockquote>
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

function AgentAvatar(props: {
  agentId?: string;
  name: string;
  avatarText: string;
  avatarColor: string;
  avatarUrl?: string;
  onClick?: (agentId: string, target: HTMLElement) => void;
}) {
  const avatarInfo = getAgentAvatarInfo(
    props.agentId ?? props.name,
    props.avatarUrl ?? props.avatarText,
    props.name,
  );
  const clickable = Boolean(props.agentId && props.onClick);

  const handleClick = (target: HTMLElement) => {
    if (!props.agentId || !props.onClick) {
      return;
    }

    props.onClick(props.agentId, target);
  };

  if (avatarInfo.type === "image" && clickable) {
    return (
      <button
        type="button"
        onClick={(event) => {
          handleClick(event.currentTarget);
        }}
        className="chat-avatar assistant chat-avatar--button"
        aria-label={`编辑 ${props.name} 的资料`}
        title={`编辑 ${props.name} 的资料`}
      >
        <img
          alt={props.name}
          className="h-full w-full rounded-[inherit] object-cover"
          src={avatarInfo.value}
        />
      </button>
    );
  }

  if (avatarInfo.type === "image") {
    return <img alt={props.name} className="chat-avatar assistant" src={avatarInfo.value} />;
  }

  if (clickable) {
    return (
      <button
        type="button"
        onClick={(event) => {
          handleClick(event.currentTarget);
        }}
        className="chat-avatar assistant chat-avatar--button"
        style={{ backgroundColor: props.avatarColor }}
        aria-label={`编辑 ${props.name} 的资料`}
        title={`编辑 ${props.name} 的资料`}
      >
        {avatarInfo.value}
      </button>
    );
  }

  return (
    <div className="chat-avatar assistant" style={{ backgroundColor: props.avatarColor }}>
      {avatarInfo.value}
    </div>
  );
}

function UserAvatarButton(props: {
  profile: UserProfile;
  fallbackAvatar?: string | null;
  onClick?: (target: HTMLElement) => void;
}) {
  const avatarUrl = props.profile.avatar ?? props.fallbackAvatar ?? null;

  return (
    <button
      type="button"
      onClick={(event) => {
        openUserProfilePopover(event.currentTarget);
        props.onClick?.(event.currentTarget);
      }}
      className="chat-avatar user chat-avatar-button"
      data-user-avatar="true"
      aria-label="编辑个人资料"
      title="编辑个人资料"
    >
      {avatarUrl ? (
        <img alt="用户头像" className="chat-avatar chat-avatar-image" src={avatarUrl} />
      ) : props.profile.name ? (
        <span>{getUserInitial(props.profile)}</span>
      ) : (
        <UserRound />
      )}
    </button>
  );
}

function AssistantActions(props: {
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRefresh: () => void;
}) {
  const actions = [
    {
      key: "copy",
      label: props.copied ? "复制成功" : "复制消息",
      icon: props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />,
      onClick: props.onCopy,
      active: props.copied,
    },
    {
      key: "download",
      label: "下载消息",
      icon: <Download className="h-4 w-4" />,
      onClick: props.onDownload,
      active: false,
    },
    {
      key: "refresh",
      label: "刷新消息",
      icon: <RefreshCw className="h-4 w-4" />,
      onClick: props.onRefresh,
      active: false,
    },
  ];

  return (
    <>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className={cn(action.active ? "chat-tts-btn--active" : "")}
        >
          {action.icon}
        </button>
      ))}
    </>
  );
}

export function MessageBubble(props: {
  message: ChatMessage;
  agentId?: string;
  agentName: string;
  agentAvatarText: string;
  agentAvatarColor: string;
  agentAvatarUrl?: string;
  userAvatar?: string | null;
  userProfile: UserProfile;
  isCopied: boolean;
  isTyping: boolean;
  onTypingComplete: () => void;
  onUserAvatarClick?: (target: HTMLElement) => void;
  onAgentAvatarClick?: (agentId: string, target: HTMLElement) => void;
  onCopy: (message: ChatMessage) => void;
  onDownload: (message: ChatMessage) => void;
  onRefresh: (message: ChatMessage) => void;
  searchQuery?: string;
}) {
  const timestampText = formatMessageTimestamp(props.message);
  const highlightQuery = props.searchQuery ?? "";
  const bubbleClassName = cn(
    "chat-bubble",
    props.message.isNew ? "fade-in" : "",
    props.isTyping ? "streaming" : "",
  );
  const userName = props.userProfile.name ?? "你";

  if (props.message.role === "user") {
    return (
      <div className="chat-group user">
        <UserAvatarButton
          profile={props.userProfile}
          fallbackAvatar={props.userAvatar}
          onClick={props.onUserAvatarClick}
        />
        <div className="chat-group-messages">
          <div className={bubbleClassName} data-message-id={props.message.id}>
            <div className="chat-text">
              {highlightPlainText(props.message.content, highlightQuery)}
            </div>
          </div>
          <div className="chat-group-footer">
            <span className="chat-sender-name">{userName}</span>
            <span className="chat-group-timestamp">{timestampText}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-group assistant">
      <AgentAvatar
        agentId={props.agentId}
        name={props.agentName}
        avatarColor={props.agentAvatarColor}
        avatarText={props.agentAvatarText}
        avatarUrl={props.agentAvatarUrl}
        onClick={props.onAgentAvatarClick}
      />
      <div className="chat-group-messages">
        <div className={bubbleClassName} data-message-id={props.message.id}>
          <button
            type="button"
            onClick={() => props.onCopy(props.message)}
            className="chat-copy-btn"
            data-copied={props.isCopied ? "1" : "0"}
            aria-label="复制消息"
          >
            <span className="chat-copy-btn__icon">
              <span className="chat-copy-btn__icon-copy">
                <Copy />
              </span>
              <span className="chat-copy-btn__icon-check">
                <Check />
              </span>
            </span>
          </button>

          {props.message.thinking?.trim() ? (
            <details className="chat-thinking">
              <summary>思考过程</summary>
              <div>{props.message.thinking}</div>
            </details>
          ) : null}

          <StaticMarkdownText
            content={props.message.content}
            className="break-words"
            highlightQuery={highlightQuery}
          />
        </div>

        <div className="chat-group-footer">
          <span className="chat-sender-name">{props.agentName}</span>
          <span className="chat-group-timestamp">{timestampText}</span>
          <AssistantActions
            copied={props.isCopied}
            onCopy={() => props.onCopy(props.message)}
            onDownload={() => props.onDownload(props.message)}
            onRefresh={() => props.onRefresh(props.message)}
          />
        </div>
      </div>
    </div>
  );
}
