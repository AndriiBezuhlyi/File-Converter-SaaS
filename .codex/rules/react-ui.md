# React and UI

Reference: relevant [DESIGN](../../DESIGN.md) sections; AI Slop Detection applies to visual changes.

- Use React/TypeScript, SCSS Modules, semantic tokens, feature composition, and Ukrainian UI copy. Keep bootstrap focused on composition.
- Provide responsive keyboard flows, labels, focus, loading/error/empty/success states, and file selection without dragging.
- Show supported formats and real upload progress. No invented conversion percentages, ETAs, queue positions, metrics, or unsupported controls.
- First guest conversion starts directly; after success, authenticate before the next upload. Existing guest downloads remain accessible until expiry.
- Keep selected files in memory; request reselection after navigation loses them. No files, sessions, or API secrets in browser storage.
- Consult API contracts/server-state rules when changing data access or retry behavior.
- Reproduce UI bugs before changes; inspect console/network/DOM, then re-check. Use Chrome DevTools when practical, existing Playwright if unavailable, and state the fallback. Do not install tools to bypass failures.
