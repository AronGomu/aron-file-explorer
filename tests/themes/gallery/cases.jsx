import React from "react";
import SettingsProvider from "../../../src/providers/SettingsProvider.jsx";
import ThemeProvider from "../../../src/providers/ThemeProvider.jsx";
import SettingsPanel from "../../../src/components/settings/SettingsPanel.jsx";
import Button from "../../../src/components/common/Button.jsx";

export function renderCase(caseId) {
  switch (caseId) {
    case "reload":
    case "settings":
      return <SettingsProvider><ThemeProvider><SettingsPanel isOpen onClose={() => {}} /></ThemeProvider></SettingsProvider>;
    case "harness-button":
      return (
        <Button type="button" onClick={() => {}}>
          Harness button
        </Button>
      );
    default:
      throw new Error(`Unknown theme gallery case: ${caseId}`);
  }
}
