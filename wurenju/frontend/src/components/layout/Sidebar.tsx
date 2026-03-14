"use client";

import { useState } from "react";
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Briefcase,
  Users,
} from "lucide-react";

export interface Employee {
  id: string;
  name: string;
  role: string;
  status: "online" | "thinking" | "offline" | "error";
  lastMessage: string;
  timestamp: string;
  avatarColor: string;
  avatarText: string;
}

export interface Department {
  id: string;
  name: string;
  employees: Employee[];
}

const DEPARTMENTS: Department[] = [
  {
    id: "pinned",
    name: "置顶",
    employees: [
      {
        id: "summer",
        name: "Summer",
        role: "AI设计总监",
        status: "online",
        lastMessage: "我已完成品牌视觉方案初稿，请查收。",
        timestamp: "14:32",
        avatarColor: "#FF6B35",
        avatarText: "S",
      },
    ],
  },
  {
    id: "strategy",
    name: "全局统筹",
    employees: [
      {
        id: "nova",
        name: "Nova",
        role: "AI战略顾问",
        status: "thinking",
        lastMessage: "正在分析Q4市场数据，稍后汇报。",
        timestamp: "13:58",
        avatarColor: "#A78BFA",
        avatarText: "N",
      },
      {
        id: "trumind",
        name: "Trumind",
        role: "CEO影子",
        status: "online",
        lastMessage: "已同步今日日程安排至日历。",
        timestamp: "12:10",
        avatarColor: "#34D399",
        avatarText: "T",
      },
    ],
  },
  {
    id: "tech",
    name: "技术团队",
    employees: [
      {
        id: "gates",
        name: "Gates",
        role: "研发负责人",
        status: "online",
        lastMessage: "API接口已部署，测试通过。",
        timestamp: "11:45",
        avatarColor: "#60A5FA",
        avatarText: "G",
      },
      {
        id: "eric",
        name: "Eric",
        role: "运维负责人",
        status: "offline",
        lastMessage: "服务器状态正常，无告警。",
        timestamp: "昨天",
        avatarColor: "#4B5563",
        avatarText: "E",
      },
      {
        id: "atlas",
        name: "Atlas",
        role: "AI项目经理",
        status: "online",
        lastMessage: "Sprint回顾报告已生成完毕。",
        timestamp: "10:20",
        avatarColor: "#F59E0B",
        avatarText: "A",
      },
    ],
  },
  {
    id: "business",
    name: "业务团队",
    employees: [
      {
        id: "olivia",
        name: "Olivia",
        role: "营销负责人",
        status: "thinking",
        lastMessage: "社媒内容策略正在生成中...",
        timestamp: "09:55",
        avatarColor: "#EC4899",
        avatarText: "O",
      },
    ],
  },
];

const STATUS_COLOR: Record<string, string> = {
  online: "#34D399",
  thinking: "#A78BFA",
  offline: "#4B5563",
  error: "#F87171",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
      style={{
        backgroundColor: STATUS_COLOR[status] ?? "#4B5563",
        borderColor: "#111118",
      }}
    />
  );
}

interface SidebarProps {
  selectedId: string;
  onSelectEmployee: (emp: Employee) => void;
}

export function Sidebar({ selectedId, onSelectEmployee }: SidebarProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleDept = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filtered = DEPARTMENTS.map((dept) => ({
    ...dept,
    employees: dept.employees.filter(
      (e) =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.role.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((dept) => dept.employees.length > 0);

  return (
    <aside
      className="flex flex-col h-full border-r"
      style={{
        width: "var(--sidebar-w)",
        minWidth: "var(--sidebar-w)",
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Brand Area */}
      <div className="p-4 space-y-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 brand-gradient"
          >
            S
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
              SoloBrave
            </div>
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              永不下线的无人局
            </div>
          </div>
        </div>
        {/* Office Button */}
        <button
          className="w-full rounded-lg p-2.5 text-left transition-all duration-150 hover:opacity-90 active:opacity-75"
          style={{ background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" }}
        >
          <div className="text-white font-semibold text-sm">进入「无人局办公室」</div>
          <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>
            观察AI状态，高级配置
          </div>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "var(--text-secondary)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md text-sm outline-none transition-all duration-150"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>

      {/* Add Employee + Function Buttons */}
      <div className="px-3 py-2.5 space-y-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <button
          className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:opacity-75"
          style={{ background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" }}
        >
          + 新增员工
        </button>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 hover:opacity-80"
            style={{
              color: "var(--brand-from)",
              borderBottom: "2px solid var(--brand-from)",
              backgroundColor: "transparent",
            }}
          >
            <Briefcase className="w-3 h-3" />
            职能
            <Plus className="w-3 h-3" style={{ color: "var(--text-secondary)" }} />
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 hover:opacity-80"
            style={{
              color: "var(--text-secondary)",
              backgroundColor: "transparent",
            }}
          >
            <Users className="w-3 h-3" />
            项目组
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Employee List */}
      <div className="flex-1 overflow-y-auto im-scroll">
        {filtered.map((dept) => (
          <div key={dept.id}>
            {/* Department Header */}
            <button
              onClick={() => toggleDept(dept.id)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150 hover:opacity-80"
            >
              {collapsed[dept.id] ? (
                <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
              ) : (
                <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
              )}
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {dept.name}
              </span>
              <span className="text-xs ml-1" style={{ color: "var(--text-secondary)" }}>
                {dept.employees.length}
              </span>
            </button>

            {/* Employee Rows */}
            {!collapsed[dept.id] &&
              dept.employees.map((emp) => {
                const isSelected = emp.id === selectedId;
                return (
                  <button
                    key={emp.id}
                    onClick={() => onSelectEmployee(emp)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 relative"
                    style={{
                      backgroundColor: isSelected ? "rgba(255,107,53,0.07)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.03)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                    }}
                  >
                    {/* Selected indicator */}
                    {isSelected && (
                      <span
                        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r"
                        style={{ background: "linear-gradient(to bottom, var(--brand-from), var(--brand-to))" }}
                      />
                    )}

                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: emp.avatarColor }}
                      >
                        {emp.avatarText}
                      </div>
                      <StatusDot status={emp.status} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {emp.name}
                        </span>
                        <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                          {emp.timestamp}
                        </span>
                      </div>
                      <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                        {emp.role}
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                        {emp.lastMessage}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      {/* Bottom Status */}
      <div
        className="px-4 py-2.5 flex items-center gap-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#34D399" }} />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          已连接
        </span>
      </div>
    </aside>
  );
}

export { DEPARTMENTS };
    </aside>
  );
}

export { DEPARTMENTS };
