import { AnimatePresence, LayoutGroup } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ActivityFeed } from "@/components/office/ActivityFeed";
import { AgentCard } from "@/components/office/AgentCard";
import { ConfigEditorModal } from "@/components/office/ConfigEditorModal";
import { ScheduledTasks } from "@/components/office/ScheduledTasks";
import { TopBar } from "@/components/office/TopBar";
import { ZoneContainer } from "@/components/office/ZoneContainer";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useCronStore } from "@/stores/cronStore";
import { useOfficeStore } from "@/stores/officeStore";

export function OfficePage() {
  console.log("[Office] render");

  const navigate = useNavigate();
  const agents = useAgentStore((state) => state.agents);
  const isAgentLoading = useAgentStore((state) => state.isLoading);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);

  const agentZones = useOfficeStore((state) => state.agentZones);
  const agentStatus = useOfficeStore((state) => state.agentStatus);
  const agentAnimations = useOfficeStore((state) => state.agentAnimations);
  const agentMetrics = useOfficeStore((state) => state.agentMetrics);
  const activityLog = useOfficeStore((state) => state.activityLog);
  const initialize = useOfficeStore((state) => state.initialize);
  const syncAgents = useOfficeStore((state) => state.syncAgents);
  const initializeCron = useCronStore((state) => state.initialize);

  const gatewayStatus = useChatStore((state) => state.status);

  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false,
  );
  const [isConfigEditorOpen, setIsConfigEditorOpen] = useState(false);
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);
  const [activePanel, setActivePanel] = useState<"activity" | "tasks">("activity");

  useEffect(() => {
    console.log(
      "[Office] OfficePage mounted, agentZones:",
      Array.from(useOfficeStore.getState().agentZones.entries()),
    );
    initialize();
    initializeCron();
  }, [initialize, initializeCron]);

  useEffect(() => {
    syncAgents(agents);
  }, [agents, syncAgents]);

  useEffect(() => {
    if (agents.length > 0 || isAgentLoading) {
      return;
    }

    void fetchAgents().catch((error) => {
      console.error("[Office] fetchAgents failed:", error);
    });
  }, [agents.length, fetchAgents, isAgentLoading]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const chatAgents = agents.filter((agent) => (agentZones.get(agent.id) ?? "lounge") === "chat");
  const workAgents = agents.filter((agent) => (agentZones.get(agent.id) ?? "lounge") === "work");
  const loungeAgents = agents.filter(
    (agent) => (agentZones.get(agent.id) ?? "lounge") === "lounge",
  );
  const mergedActivityLog = [...activityLog]
    .toSorted((left, right) => right.time - left.time)
    .slice(0, 120);

  async function handleToggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        return;
      }

      await document.exitFullscreen();
    } catch (error) {
      console.error("[Office] fullscreen failed:", error);
    }
  }

  async function handleConfirmRestartGateway() {
    setIsRestartingGateway(true);

    try {
      await gateway.restartGateway({
        note: "龙虾办公室手动触发网关重启",
        restartDelayMs: 0,
      });
      console.log("[Office] gateway restart scheduled");
      setIsRestartModalOpen(false);
      toast({
        title: "✅ 已触发网关重启",
        description: "连接会短暂断开约 1-2 秒，请稍候。",
      });
    } catch (error) {
      console.error("[Office] gateway restart failed:", error);
      toast({
        title: "重启失败",
        description:
          error instanceof Error && error.message.trim()
            ? error.message
            : "网关重启失败，请稍后重试",
        variant: "destructive",
      });
    } finally {
      setIsRestartingGateway(false);
    }
  }

  return (
    <>
      <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--color-bg-primary)]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top, color-mix(in srgb, var(--accent) 8%, transparent), transparent 34%)",
          }}
        />

        <TopBar
          isFullscreen={isFullscreen}
          isRestarting={isRestartingGateway}
          restartDisabled={isRestartingGateway || gatewayStatus !== "connected"}
          configDisabled={isRestartingGateway || gatewayStatus !== "connected"}
          onBack={() => navigate("/")}
          onRestart={() => {
            setIsRestartModalOpen(true);
          }}
          onOpenConfigEditor={() => {
            setIsConfigEditorOpen(true);
          }}
          onToggleFullscreen={() => {
            void handleToggleFullscreen();
          }}
        />

        <div className="relative flex min-h-0 flex-1 gap-4 px-5 py-4">
          <div className="flex min-h-0 min-w-0 flex-[7] flex-col gap-3">
            <LayoutGroup id="office-agent-layout">
              <ZoneContainer
                title="💬 对话区 Chat Zone"
                count={chatAgents.length}
                emptyText="当前无活跃对话"
                hasItems={chatAgents.length > 0}
                className="flex-[0.98]"
              >
                <div className="grid auto-rows-max grid-cols-2 gap-3">
                  <AnimatePresence initial={false}>
                    {chatAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        zone="chat"
                        status={
                          agentStatus.get(agent.id) ?? { action: "thinking", detail: "🧠 思考中…" }
                        }
                        motionState={agentAnimations.get(agent.id)}
                        metrics={agentMetrics.get(agent.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </ZoneContainer>

              <ZoneContainer
                title="🏢 办公区 Work Zone"
                count={workAgents.length}
                emptyText="当前无后台任务"
                hasItems={workAgents.length > 0}
                className="flex-[0.9]"
              >
                <div className="grid auto-rows-max grid-cols-2 gap-3">
                  <AnimatePresence initial={false}>
                    {workAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        zone="work"
                        status={
                          agentStatus.get(agent.id) ?? {
                            action: "working",
                            detail: "🔧 执行后台任务…",
                          }
                        }
                        motionState={agentAnimations.get(agent.id)}
                        metrics={agentMetrics.get(agent.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </ZoneContainer>
            </LayoutGroup>

            <ZoneContainer
              title="☕ 休闲区 Lounge"
              count={loungeAgents.length}
              emptyText={isAgentLoading ? "员工载入中…" : "当前无待机员工"}
              hasItems={loungeAgents.length > 0}
              className="flex-[1.02]"
            >
              <div className="grid auto-rows-max grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-4">
                <AnimatePresence initial={false}>
                  {loungeAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      zone="lounge"
                      status={agentStatus.get(agent.id) ?? { action: "standby", detail: "STANDBY" }}
                      motionState={agentAnimations.get(agent.id)}
                      metrics={agentMetrics.get(agent.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </ZoneContainer>
          </div>

          <div className="flex h-full min-h-0 w-[32%] min-w-[340px] max-w-[460px] flex-col gap-4">
            <div className="rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] p-2 backdrop-blur-xl">
              <div className="flex gap-2">
                {[
                  { key: "activity", label: "⚡ 动态" },
                  { key: "tasks", label: "⏰ 定时任务" },
                ].map((item) => {
                  const active = item.key === activePanel;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActivePanel(item.key as "activity" | "tasks")}
                      className={cn(
                        "flex-1 rounded-[18px] px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {activePanel === "activity" ? (
                <ActivityFeed items={mergedActivityLog} connected={gatewayStatus === "connected"} />
              ) : (
                <ScheduledTasks />
              )}
            </div>
          </div>
        </div>
        <Toaster className="z-[120]" />
      </div>
      <ConfigEditorModal
        open={isConfigEditorOpen}
        onOpenChange={(nextOpen) => {
          setIsConfigEditorOpen(nextOpen);
        }}
      />
      <ConfirmModal
        open={isRestartModalOpen}
        onClose={() => {
          if (!isRestartingGateway) {
            setIsRestartModalOpen(false);
          }
        }}
        onConfirm={() => {
          void handleConfirmRestartGateway();
        }}
        loading={isRestartingGateway}
        icon="🦞"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="重启网关"
        subtitle="网关服务将立即重新加载"
        description="确定要重启网关吗？重启期间连接会短暂断开（约 1-2 秒）。"
        confirmText="确认重启"
        confirmColor="bg-[var(--warn)] hover:brightness-110"
      />
    </>
  );
}
