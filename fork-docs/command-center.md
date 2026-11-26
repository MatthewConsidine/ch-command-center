# Command Center (fork feature)

A sidebar entry that puts one chief agent in the center and the user's projects in a column on the right.

- **Route:** `/app/command-center` (`src/renderer/routes/app/command-center.tsx`). With no chief chosen it shows a setup form; otherwise it renders the normal agent chat (`AgentPage` with `variant="commandCenter"`), so approvals, files, tools and sub-agent cards work as in the Agents tab.
- **Projects:** user workspaces. Each project's lead is the agent chosen in settings, else the agent of the workspace's newest session. Workspaces the chief leads are left out.
- **Opening a project:** selects the lead's newest session in that workspace, or starts a new one there.
- **Settings:** `feature.command_center.chief_agent_id` and `feature.command_center.lead_agents` (workspace id → agent id), editable from the pane's settings button.
- **Upstream touch points** (expect these on rebase): `AgentPage.tsx` (variant, `routeBase` in navigations, right-side pane), `utils/sidebar.ts`, `components/app/sidebarIcons.tsx`, `i18n/label.ts`, `utils/routeTitle.ts`, `pages/launchpad/LaunchpadPage.tsx`, the sidebar default in `target-key-definitions.json`.
