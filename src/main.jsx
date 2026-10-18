import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ChooserApp from "./chooser/ChooserApp.jsx";
import { bootstrapTheme } from "./themes/applyTheme";
// Wichtig: Hier Tauri API importieren, wenn es irgendwo in der App verwendet wird
import { invoke } from "@tauri-apps/api/core";
import { readExplorerSession, EXPLORER_SESSION_KEY } from "./utils/explorerSession";

// Import CSS in the correct order
// 1. Variables first (design tokens)
import "./styles/variables.css";
// 2. Base/reset styles
import "./styles/global.css";
// 3. Theme styles for light/dark mode
import "./styles/theme.css";
// 4. Component styles
import "./styles/components.css";
// 5. Modern enhancements and effects
import "./styles/modern.css";

// Import font (Inter)
// For production, consider using a font loading strategy or self-hosting the font
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
document.head.appendChild(fontLink);

// Stelle sicher, dass window.invoke verfügbar ist, falls du es global verwendest
window.__TAURI_INVOKE__ = invoke;

bootstrapTheme();

// Resolve desktop folder arguments before providers restore their initial tabs.
async function initialize() {
    try {
        const request = await invoke('get_chooser_request');
        if (request) {
            ReactDOM.createRoot(document.getElementById('root')).render(<ChooserApp request={request} />);
            return;
        }
    } catch (_) {
        // The normal explorer binary does not expose chooser commands.
    }
    try {
        const request = await invoke('get_launch_request');
        const paths = request.directories;
        sessionStorage.setItem('fileExplorerLaunchSelection', JSON.stringify(request));
        if (paths.length) {
            if (request.properties) {
                localStorage.setItem('fileExplorerDetailsPanelOpen', 'true');
                localStorage.setItem('fileExplorerDetailsVisible', 'true');
            }
            const session = readExplorerSession();
            for (const path of paths) {
                let tab = session.tabs.find(tab => tab.path === path);
                if (!tab) {
                    tab = { id: crypto.randomUUID(), path };
                    session.tabs.push(tab);
                }
                session.activeTabId = tab.id;
            }
            localStorage.setItem(EXPLORER_SESSION_KEY, JSON.stringify(session));
        }
    } catch (error) {
        console.error('Failed to read launch directories:', error);
    }

    // Initialize the application
    ReactDOM.createRoot(document.getElementById("root")).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}

initialize();
