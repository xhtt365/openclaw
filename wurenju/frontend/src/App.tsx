import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { OfficePage } from "@/pages/OfficePage";
import { useChatStore } from "@/stores/chatStore";
import { useHealthStore } from "@/stores/healthStore";

function App() {
  const connect = useChatStore((s) => s.connect);
  const initializeHealth = useHealthStore((state) => state.initialize);

  useEffect(() => {
    connect();
    initializeHealth();
  }, [connect, initializeHealth]);

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
