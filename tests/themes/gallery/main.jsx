import React from "react";
import ReactDOM from "react-dom/client";
import { renderCase } from "./cases.jsx";
import { mockIPC } from "@tauri-apps/api/mocks";

import { applyThemeToDOM, EMBEDDED_THEMES } from "../../../src/themes/applyTheme";
import "../../../src/styles/variables.css";
import "../../../src/styles/global.css";
import "../../../src/styles/theme.css";
import "../../../src/styles/components.css";
import "../../../src/styles/modern.css";

const params = new URLSearchParams(window.location.search);
const caseId = params.get("case") || "harness-button";
const theme = params.get("theme") || "catppuccin-latte";
const definition = EMBEDDED_THEMES.find(definition => definition.id === theme);
if (!definition) throw new Error(`Unknown theme gallery theme: ${theme}`);
applyThemeToDOM(definition);
let settings = { active_theme_id: theme };
mockIPC((command, args) => {
  if (caseId === "settings") {
    if (command === "get_settings_snapshot") return { settings, loadError: null };
    if (command === "get_theme_catalog") return { revision: 1, directory: "/fixture/config/com.explr.app/themes", themes: EMBEDDED_THEMES, issues: [] };
    if (command === "set_active_theme_id") {
      if (args.id !== "system" && !EMBEDDED_THEMES.some(theme => theme.id === args.id)) throw { code: "unavailable", message: "Theme is unavailable" };
      settings = { ...settings, active_theme_id: args.id };
      return { active_theme_id: args.id };
    }
    if (command === "reset_settings_command") { settings = { active_theme_id: "system" }; return JSON.stringify(settings); }
  }
  throw new Error(`Unknown theme gallery IPC command: ${command}`);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <main data-theme-case={caseId} data-theme={theme}>
    {renderCase(caseId)}
  </main>,
);
