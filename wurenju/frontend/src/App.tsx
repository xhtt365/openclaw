import { useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/components/layout/ThemeProvider"
import { AppLayout } from "@/components/layout/AppLayout"
import { Toaster } from "@/components/ui/toaster"
import { OfficePage } from "@/pages/OfficePage"
import { useChatStore } from "@/stores/chatStore"

function App() {
  const connect = useChatStore((s) => s.connect)

  useEffect(() => {
    connect()
  }, [connect])

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
