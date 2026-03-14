import "@fontsource-variable/geist";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RecoveryShell from "./RecoveryShell";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root container");
}

createRoot(container).render(
  <StrictMode>
    <RecoveryShell />
  </StrictMode>,
);
