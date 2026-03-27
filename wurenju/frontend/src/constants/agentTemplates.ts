export interface AgentFileTemplate {
  name: string;
  content: string;
}

export interface AgentTemplateVariables {
  agentName: string;
  emoji: string;
  role: string;
  description: string;
}

// 默认身份模板，创建后就能在详情页里直接编辑。
const IDENTITY_TEMPLATE = `# {agentName}

- Name: {agentName}
- Emoji: {emoji}
- Role: {role}
- Description: {description}
`;

// 默认人格模板，约束员工的语气、边界和行为。
const SOUL_TEMPLATE = `# [SOUL.md](http://SOUL.md) — 人格与边界

## 你是谁

你是{agentName}，一个专业的 AI 员工。

## 行为准则

- 回答要简洁、准确、有帮助
- 不确定的信息要明确说明
- 遵守用户的指令和偏好

## 边界

- 不编造事实和数据
- 不执行有安全风险的操作
- 涉及敏感话题时谨慎处理
`;

// 默认用户画像模板，留给后续补充使用者信息。
const USER_TEMPLATE = `# [USER.md](http://USER.md) — 用户画像

## 关于用户

（在此描述用户的背景、偏好和工作方式）
`;

// 默认会话规则模板，约束该员工在会话中的工作方式。
const AGENTS_TEMPLATE = `# [AGENTS.md](http://AGENTS.md) — 工作规则

## 会话规则

- 每次回复保持专业和友好
- 优先理解用户意图再回答
- 复杂任务先确认再执行

## 记忆规则

- 重要信息记录到 [MEMORY.md](http://MEMORY.md)
- 定期回顾和整理记忆
`;

// 默认工具备注模板，方便记录环境和工具限制。
const TOOLS_TEMPLATE = `# [TOOLS.md](http://TOOLS.md) — 工具与环境备注

## 本地环境

（在此描述特定的工具配置和环境信息）
`;

// 默认心跳模板，后续可接自动巡检和检查项。
const HEARTBEAT_TEMPLATE = `# [HEARTBEAT.md](http://HEARTBEAT.md) — 周期性检查

## 检查清单

（在此配置需要定期执行的检查任务）
`;

export const DEFAULT_AGENT_FILES: AgentFileTemplate[] = [
  { name: "IDENTITY.md", content: IDENTITY_TEMPLATE },
  { name: "SOUL.md", content: SOUL_TEMPLATE },
  { name: "USER.md", content: USER_TEMPLATE },
  { name: "AGENTS.md", content: AGENTS_TEMPLATE },
  { name: "TOOLS.md", content: TOOLS_TEMPLATE },
  { name: "HEARTBEAT.md", content: HEARTBEAT_TEMPLATE },
];

function replaceTemplateVariables(content: string, variables: AgentTemplateVariables) {
  return [
    ["{agentName}", variables.agentName],
    ["{emoji}", variables.emoji],
    ["{role}", variables.role],
    ["{description}", variables.description],
  ].reduce(
    (nextContent, [placeholder, value]) => nextContent.split(placeholder).join(value),
    content,
  );
}

export function buildDefaultAgentFiles(variables: AgentTemplateVariables): AgentFileTemplate[] {
  return DEFAULT_AGENT_FILES.map((file) => ({
    name: file.name,
    content: replaceTemplateVariables(file.content, variables),
  }));
}
