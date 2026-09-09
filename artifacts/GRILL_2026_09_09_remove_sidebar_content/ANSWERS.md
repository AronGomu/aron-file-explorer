# Grill: Remove sidebar This PC section

## Round 1 — Removal boundary

| ID | Question | Answer | Precision |
| --- | --- | --- | --- |
| Q1 | What disappears? | A2: Remove only This PC section | Remove heading, This PC shortcut, user-volume shortcut, user-directory shortcuts. Keep Favorites, Drives, Network. |

## Facts

- F1. Wrapper starts `src/components/sidebar/Sidebar.jsx:383`; This PC section occupies lines 407–465.
- F2. Remaining sections start at `src/components/sidebar/Sidebar.jsx:466`; footer starts at line 670.
- F3. Metadata remains needed by drive ejection: `src/components/sidebar/Sidebar.jsx:531–550`.
- F4. Main This PC view renders independently: `src/layouts/MainLayout.jsx:758–759`.
- F5. `package.json:6–15` contains no test script; Node `v24.18.0` available. Use native `node:test` source-contract tests plus manual desktop validation; no new deps.

## Shared understanding

- S1. Spec level: 5 — removal boundary, preserved interfaces, test contract settled.
- S2. Goal: remove only sidebar This PC section, including built-in folder/user-volume shortcuts.
- S3. Settled: retain `.sidebar-content`, Favorites, Drives, Network, footer, main This PC view.
- S4. Contracts: `Sidebar({ onTerminalToggle, isTerminalOpen, currentView })`; retain `sidebarSectionsCollapsed` storage key, tolerate legacy `thisPC` property without migration; remove default `thisPC` property.
- S5. Assumptions: no replacement shortcuts; favorites targeting those folders remain valid; remove newly orphaned private helper chain only. No user setup needed beyond existing local dev environment.
- S6. Out: backend/IPC removal, main-view removal, CSS redesign, storage migration, unrelated bugs, commits, publishing.
- S7. Residual: glossary skill missing at `.agents/skills/make-glossary-aron/SKILL.md`; existing SFTP error swallowing/listener cleanup outside scope. Native runtime checks belong to implementation, not planning.
