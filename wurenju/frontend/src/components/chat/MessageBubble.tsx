"use client";

import { Check, Copy, Download, RefreshCw, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightPlainText, highlightReactChildren } from "@/components/chat/messageSearch";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { TypewriterText } from "@/components/chat/TypewriterText";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/utils/messageAdapter";

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

function isFriendlyConnectionError(content: string) {
  const normalized = content.trim();
  return (
    normalized.startsWith("当前模型连接失败（401）") ||
    normalized.startsWith("当前模型连接失败（502）") ||
    normalized.startsWith("连接错误：")
  );
}

function StaticMarkdownText(props: {
  content: string;
  className?: string;
  highlightQuery?: string;
}) {
  return (
    <div className={props.className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children, ...nodeProps }) => (
            <p className="mb-3 last:mb-0" {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </p>
          ),
          ul: ({ ...nodeProps }) => (
            <ul className="my-3 list-disc space-y-1.5 pl-5" {...nodeProps} />
          ),
          ol: ({ ...nodeProps }) => (
            <ol className="my-3 list-decimal space-y-1.5 pl-5" {...nodeProps} />
          ),
          li: ({ children, ...nodeProps }) => (
            <li className="leading-7" {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </li>
          ),
          a: ({ children, ...nodeProps }) => (
            <a
              {...nodeProps}
              className="text-[var(--color-brand-light)] underline underline-offset-2"
              rel="noreferrer noopener"
              target="_blank"
            >
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </a>
          ),
          pre: ({ children, ...nodeProps }) => (
            <pre
              className="my-3 overflow-x-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-code-block)] p-3 text-[0.92em]"
              {...nodeProps}
            >
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </pre>
          ),
          code: ({ children, className: codeClassName, ...nodeProps }) => (
            <code
              className={cn(
                "rounded bg-[var(--color-bg-code)] px-1.5 py-0.5 text-[0.92em]",
                codeClassName ? "bg-transparent px-0 py-0" : "",
              )}
              {...nodeProps}
            >
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </code>
          ),
          strong: ({ children, ...nodeProps }) => (
            <strong className="font-semibold" {...nodeProps}>
              {highlightReactChildren(children, props.highlightQuery ?? "")}
            </strong>
          ),
          blockquote: ({ children, ...nodeProps }) => (
            <blockquote
              className="my-3 border-l-2 border-[var(--color-border-quote)] pl-4 text-[var(--color-text-secondary)]"
              {...nodeProps}
            >
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
  name: string;
  avatarText: string;
  avatarColor: string;
  avatarUrl?: string;
}) {
  if (props.avatarUrl) {
    return (
      <img
        alt={props.name}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
        src={props.avatarUrl}
      />
    );
  }

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-[var(--color-text-on-brand)]"
      style={{ backgroundColor: props.avatarColor }}
    >
      {props.avatarText}
    </div>
  );
}

function UserAvatarButton(props: { avatarUrl?: string | null; onClick: () => void }) {
  if (props.avatarUrl) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className="group/avatar relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--color-border)] transition-transform duration-200 hover:scale-105"
        aria-label="上传用户头像"
        title="上传用户头像"
      >
        <img alt="用户头像" className="h-full w-full object-cover" src={props.avatarUrl} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] transition-transform duration-200 hover:scale-105 hover:text-[var(--color-text-primary)]"
      aria-label="上传用户头像"
      title="上传用户头像"
    >
      <UserRound className="h-4 w-4" />
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
    },
    {
      key: "download",
      label: "下载消息",
      icon: <Download className="h-4 w-4" />,
      onClick: props.onDownload,
    },
    {
      key: "refresh",
      label: "刷新消息",
      icon: <RefreshCw className="h-4 w-4" />,
      onClick: props.onRefresh,
    },
  ];

  return (
    <div className="mt-3 flex items-center gap-3">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-all duration-150 hover:scale-110 hover:text-[var(--color-text-primary)]",
            action.key === "copy" && props.copied ? "text-[var(--color-online)]" : "",
          )}
          style={action.key === "copy" && props.copied ? undefined : { opacity: 0.6 }}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}

export function MessageBubble(props: {
  message: ChatMessage;
  agentName: string;
  agentAvatarText: string;
  agentAvatarColor: string;
  agentAvatarUrl?: string;
  userAvatar?: string | null;
  isCopied: boolean;
  isTyping: boolean;
  onTypingComplete: () => void;
  onUserAvatarClick: () => void;
  onCopy: (message: ChatMessage) => void;
  onDownload: (message: ChatMessage) => void;
  onRefresh: (message: ChatMessage) => void;
  searchQuery?: string;
}) {
  const timestampText = formatMessageTimestamp(props.message);
  const animationClass = props.message.isNew ? "message-enter" : "";
  const isConnectionError =
    props.message.role === "assistant" && isFriendlyConnectionError(props.message.content);

  if (props.message.role === "user") {
    return (
      <div className={cn("flex w-full justify-end", animationClass)}>
        <div className="flex max-w-[74%] items-start gap-3">
          <div className="flex min-w-0 flex-col items-end">
            <div className="mb-2 text-right text-[11px] text-[var(--color-text-secondary)]">
              {timestampText}
            </div>
            <div className="rounded-[12px] rounded-tr-[4px] bg-[var(--color-bg-bubble-user)] px-4 py-3 text-sm leading-7 text-[var(--color-text-primary)] shadow-[0_10px_24px_var(--color-shadow-card)]">
              <div className="whitespace-pre-wrap break-words">
                {highlightPlainText(props.message.content, props.searchQuery ?? "")}
              </div>
            </div>
          </div>
          <UserAvatarButton avatarUrl={props.userAvatar} onClick={props.onUserAvatarClick} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full justify-start", animationClass)}>
      <div className="flex max-w-[74%] items-start gap-3">
        <AgentAvatar
          name={props.agentName}
          avatarColor={props.agentAvatarColor}
          avatarText={props.agentAvatarText}
          avatarUrl={props.agentAvatarUrl}
        />
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base font-semibold text-[var(--color-text-primary)]">
              {props.agentName}
            </span>
            <span className="text-[12px] text-[var(--color-text-secondary)]">{timestampText}</span>
          </div>
          <div
            className={cn(
              "rounded-[12px] px-4 py-4 text-sm leading-7 text-[var(--color-text-primary)] shadow-[0_10px_24px_var(--color-shadow-card)]",
              isConnectionError
                ? "border border-amber-500/30 bg-amber-500/10"
                : "bg-[var(--color-bg-bubble-ai)]",
            )}
          >
            {props.message.thinking?.trim() ? (
              <ThinkingBlock thinking={props.message.thinking} />
            ) : null}

            {props.message.isHistorical ? (
              <StaticMarkdownText
                content={props.message.content}
                className="break-words text-sm leading-7"
                highlightQuery={props.searchQuery}
              />
            ) : (
              <TypewriterText
                key={props.isTyping ? `${props.message.id}-typing` : `${props.message.id}-static`}
                animate={props.isTyping}
                className="break-words text-sm leading-7"
                content={props.message.content}
                highlightQuery={props.searchQuery}
                onComplete={props.onTypingComplete}
                speed={20}
              />
            )}
          </div>
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
