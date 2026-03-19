import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { OfficePage } from "@/pages/OfficePage";
import { useChatStore } from "@/stores/chatStore";
import { useGrowthStore } from "@/stores/growthStore";
import { useHealthStore } from "@/stores/healthStore";
import { useStatsStore } from "@/stores/statsStore";
import { runStorageMaintenance } from "@/utils/storage";

function App() {
  const connect = useChatStore((s) => s.connect);
  const initializeGrowth = useGrowthStore((state) => state.initialize);
  const initializeHealth = useHealthStore((state) => state.initialize);
  const initializeStats = useStatsStore((state) => state.initialize);

  useEffect(() => {
    runStorageMaintenance("startup");
    connect();
    initializeHealth();
    initializeStats(useHealthStore.getState().recordsByAgentId);
    initializeGrowth();
  }, [connect, initializeGrowth, initializeHealth, initializeStats]);

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
