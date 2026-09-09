import React from "react";
import ReactDOM from "react-dom/client";
import { renderCase } from "./cases.jsx";
import { mockIPC } from "@tauri-apps/api/mocks";

// T1's Button needs no IPC. Later cases must explicitly allow their own fixtures.
mockIPC((command) => {
  throw new Error(`Unknown theme gallery IPC command: ${command}`);
});

const params = new URLSearchParams(window.location.search);
const caseId = params.get("case") || "harness-button";
const theme = params.get("theme") || "catppuccin-latte";

ReactDOM.createRoot(document.getElementById("root")).render(
  <main data-theme-case={caseId} data-theme={theme}>
    {renderCase(caseId)}
  </main>,
);
