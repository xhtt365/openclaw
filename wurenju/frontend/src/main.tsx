import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
// import { runGrowthTests } from './utils/growthTestRunner'; runGrowthTests();

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root container");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
