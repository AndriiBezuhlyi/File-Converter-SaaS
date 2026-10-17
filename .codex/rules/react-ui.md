# React and UI

Read [DESIGN.md](../../DESIGN.md), including AI Slop Detection, before changing visible UI.

- Use the selected React/TypeScript stack and SCSS Modules; reuse semantic tokens and component patterns. Do not introduce another styling system or animation library just to reproduce the reference.
- Preserve feature-based composition and Ukrainian product copy. Keep components focused; the app entry point remains composition/bootstrap.
- Provide responsive, accessible keyboard flows, persistent field labels, visible focus, and clear loading/error/empty/success states. File selection must work without dragging.
- Display real supported directions and actual upload progress. Do not invent conversion percentages, ETAs, queue positions, metrics, or unimplemented actions.
- An eligible guest starts the first conversion directly. After success, a new conversion opens authentication before upload; do not gate an existing guest result's download on login.
- Preserve selected files in memory where possible; ask for reselection after navigation loses them. Do not persist file contents, sessions, or API secrets in browser storage.
- Follow [api-state.md](api-state.md) for server data and retry behavior. Read actual backend contracts before presenting controls as usable.
- Reproduce browser-facing bugs before edits; inspect relevant console/network/DOM state, then re-check the affected flow with Chrome DevTools MCP when practical. Use the existing Playwright setup if MCP is unavailable, stating the reason. Do not install tools to bypass failures.
