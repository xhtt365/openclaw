// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/chat/slash-commands.ts，用于二开定制

import type { IconName } from "../icons.ts";

export type SlashCommandCategory = "session" | "model" | "agents" | "tools";

export type SlashCommandDef = {
  name: string;
  title: string;
  description: string;
  args?: string;
  icon?: IconName;
  category?: SlashCommandCategory;
  /** When true, the command is executed client-side via RPC instead of sent to the agent. */
  executeLocal?: boolean;
  /** Fixed argument choices for inline hints. */
  argOptions?: string[];
  /** Keyboard shortcut hint shown in the menu (display only). */
  shortcut?: string;
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // ── Session ──
  {
    name: "new",
    title: "新建会话",
    description: "从头开始一段新的对话",
    icon: "plus",
    category: "session",
    executeLocal: true,
  },
  {
    name: "reset",
    title: "重置会话",
    description: "清空当前消息并重新开始",
    icon: "refresh",
    category: "session",
    executeLocal: true,
  },
  {
    name: "compact",
    title: "压缩上下文",
    description: "总结历史内容，释放上下文空间",
    icon: "loader",
    category: "session",
    executeLocal: true,
  },
  {
    name: "stop",
    title: "停止运行",
    description: "立即停止当前回复或任务",
    icon: "stop",
    category: "session",
    executeLocal: true,
  },
  {
    name: "clear",
    title: "清空记录",
    description: "清掉当前界面里的聊天记录",
    icon: "trash",
    category: "session",
    executeLocal: true,
  },
  {
    name: "focus",
    title: "专注模式",
    description: "隐藏干扰内容，只保留聊天区域",
    icon: "eye",
    category: "session",
    executeLocal: true,
  },

  // ── Model ──
  {
    name: "model",
    title: "切换模型",
    description: "查看或设置当前使用的模型",
    args: "<模型名>",
    icon: "brain",
    category: "model",
    executeLocal: true,
  },
  {
    name: "think",
    title: "思考强度",
    description: "调整 AI 的思考深度",
    args: "<级别>",
    icon: "brain",
    category: "model",
    executeLocal: true,
    argOptions: ["off", "low", "medium", "high"],
  },
  {
    name: "verbose",
    title: "详细模式",
    description: "切换简洁、详细或完整输出",
    args: "<on|off|full>",
    icon: "terminal",
    category: "model",
    executeLocal: true,
    argOptions: ["on", "off", "full"],
  },
  {
    name: "fast",
    title: "快速模式",
    description: "切换更快的回复模式",
    args: "<status|on|off>",
    icon: "zap",
    category: "model",
    executeLocal: true,
    argOptions: ["status", "on", "off"],
  },

  // ── Tools ──
  {
    name: "help",
    title: "查看命令",
    description: "显示所有可用命令",
    icon: "book",
    category: "tools",
    executeLocal: true,
  },
  {
    name: "status",
    title: "系统状态",
    description: "查看当前会话状态",
    icon: "barChart",
    category: "tools",
  },
  {
    name: "export",
    title: "导出 Markdown",
    description: "把当前对话导出为 Markdown",
    icon: "download",
    category: "tools",
    executeLocal: true,
  },
  {
    name: "usage",
    title: "Token 用量",
    description: "查看当前会话的 Token 使用情况",
    icon: "barChart",
    category: "tools",
    executeLocal: true,
  },

  // ── Agents ──
  {
    name: "agents",
    title: "查看智能体",
    description: "列出当前可用的智能体",
    icon: "monitor",
    category: "agents",
    executeLocal: true,
  },
  {
    name: "kill",
    title: "结束子智能体",
    description: "中止指定或全部子智能体",
    args: "<id|all>",
    icon: "x",
    category: "agents",
    executeLocal: true,
  },
  {
    name: "skill",
    title: "运行技能",
    description: "运行一个预设技能",
    args: "<技能名>",
    icon: "zap",
    category: "tools",
  },
  {
    name: "steer",
    title: "控制子智能体",
    description: "向子智能体发送控制消息",
    args: "<id> <消息>",
    icon: "send",
    category: "agents",
  },
];

const CATEGORY_ORDER: SlashCommandCategory[] = ["session", "model", "tools", "agents"];

export const CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  session: "会话",
  model: "模型",
  agents: "智能体",
  tools: "工具",
};

export function getSlashCommandCompletions(filter: string): SlashCommandDef[] {
  const lower = filter.toLowerCase();
  const commands = lower
    ? SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.name.startsWith(lower) ||
          cmd.title.toLowerCase().includes(lower) ||
          cmd.description.toLowerCase().includes(lower),
      )
    : SLASH_COMMANDS;
  return commands.toSorted((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category ?? "session");
    const bi = CATEGORY_ORDER.indexOf(b.category ?? "session");
    if (ai !== bi) {
      return ai - bi;
    }
    // Exact prefix matches first
    if (lower) {
      const aExact = a.name.startsWith(lower) ? 0 : 1;
      const bExact = b.name.startsWith(lower) ? 0 : 1;
      if (aExact !== bExact) {
        return aExact - bExact;
      }
    }
    return 0;
  });
}

export type ParsedSlashCommand = {
  command: SlashCommandDef;
  args: string;
};

/**
 * Parse a message as a slash command. Returns null if it doesn't match.
 * Supports `/command`, `/command args...`, and `/command: args...`.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  const firstSeparator = body.search(/[\s:]/u);
  const name = firstSeparator === -1 ? body : body.slice(0, firstSeparator);
  let remainder = firstSeparator === -1 ? "" : body.slice(firstSeparator).trimStart();
  if (remainder.startsWith(":")) {
    remainder = remainder.slice(1).trimStart();
  }
  const args = remainder.trim();

  if (!name) {
    return null;
  }

  const command = SLASH_COMMANDS.find((cmd) => cmd.name === name.toLowerCase());
  if (!command) {
    return null;
  }

  return { command, args };
}
