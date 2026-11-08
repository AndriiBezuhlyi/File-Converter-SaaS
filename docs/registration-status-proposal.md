# Pending registration status proposal — IMP-04.01

Status: approved by the owner on 2026-11-08 for IMP-04.02, subject to the plan's security requirements. Approval includes BroadcastChannel hints with polling fallback, status-only receipt authority, clear reload/expiry recovery, polling cleanup and API compatibility. No schema migration, automatic login or later policy change is authorized.

## Existing boundary and recommendation

Registration currently returns the same `202 { "status": "accepted" }` for new and duplicate accounts. `auth/session` does not identify anonymous pending registrations. Verification consumes a server-validated token; email changes separately increment `sessionVersion` and revoke sessions. Keep these boundaries and explicit link confirmation.

Recommend an opt-in receipt on the existing registration endpoint, plus one first-party status endpoint. Bind each receipt to the current cookie session and the account actually created by that registration. Store short-lived correlations in the existing Redis service, separately from the serialized express-session object. No PostgreSQL model/migration, dependency, cookie setting or session lifetime change is needed.

Compared alternatives:

- A single pending field or bounded map in express-session needs less storage code, but parallel CSRF/session saves can overwrite correlation data. One slot also makes another tab's registration replace the original tab's context. Making those updates atomic would require changing the shared session store. Reject this approach for this slice.
- A standalone bearer receipt works across browsers, but needlessly grants status authority without the original session. Reject it.
- Independent Redis keys bound to session and receipt avoid whole-session lost updates and isolate concurrent registrations. This is the recommended minimal scoped mechanism. Redis is only correlation storage; PostgreSQL remains verification authority.

## Proposed HTTP contract

All routes retain `/api/v1`, existing error envelopes, no-store/no-referrer middleware, first-party session boundary and API-key rejection. Both POST routes require the exact configured Origin and current synchronizer CSRF token. Do not permit arbitrary email/user/token status lookup.

1. `POST /auth/register`: existing email/password fields; optional `trackStatus: true`.
   - Without the flag: preserve the existing response exactly.
   - With the flag: return `202 { "status": "accepted", "registration": { "receipt": "<opaque random value>", "expiresAt": "<ISO timestamp>" } }` for both new and duplicate registration. Receipt is 32 random bytes encoded as 43 base64url characters. Expiry is 15 minutes after issuance, absolute and non-renewable.
   - Only an account newly created by this request gets a real account correlation. A duplicate gets an indistinguishable decoy receipt, even if its supplied password happens to match. No extra email is sent merely to establish correlation. Preserve existing rate limits and password hashing on duplicates.
2. `POST /auth/registration/status`: body `{ "receipt": "<opaque random value>" }`.
   - `200 { "status": "pending" }` for an unverified correlated account or unexpired decoy.
   - `200 { "status": "verified" }` only when the correlated account exists, its original email and session version still match, and PostgreSQL has a non-null `emailVerifiedAt`.
   - `200 { "status": "expired" }` for unknown/expired/wrong-session receipts or invalidated account correlation. Do not distinguish those cases.
   - Invalid body: existing validation error; Origin/CSRF/API-key/rate errors retain current semantics; unavailable Redis/database: sanitized `503`, never a guessed pending/verified result.
   - Reuse global first-party rate limiting; add a bounded status policy of 30 requests/minute per session and 60/minute per IP, with Retry-After. Do not refresh receipt expiry on reads.

## Correlation and failure boundaries

Use namespaced Redis keys containing only hashes of session ID and receipt, not raw credentials or email. Values hold the new user's ID, a hash of its normalized original email, initial session version and absolute expiry; decoys hold no user ID. A single TTL-bound SET creates each independent record; lookups do not mutate it. Existing registration rate limits and 15-minute TTL bound growth.

Issue the record only after successful registration transaction completion. If Redis persistence fails after the account commits, return unavailable; keep the existing account/notification intact. The UI explains uncertain completion and offers sign-in/resend rather than automatically repeating registration. No distributed transaction, compensation deletion or automatic registration retry is introduced.

Session rotation, logout or cookie expiry makes old receipts unusable because their session binding changes. Existing session-revocation machinery remains untouched. Short-lived Redis records expire naturally. Account deletion, password/session-version changes and email changes invalidate real correlations. Resending verification may replace the email token, but does not change the original registration receipt or its expiry.

## Browser behavior and bounded lifecycle

- Keep receipt and expiry only in application memory, associated with the specific registration result and gateway scope. Never put them in URLs, browser storage, logs, analytics, query caches, messages or screenshots. Different tabs retain independent receipts. Navigating away may discard the UI context; reload loses it and shows ordinary sign-in/resend guidance, never an unproven success. Surviving reload would require a separately approved recovery mechanism.
- After a verification POST succeeds, its tab renders local server-confirmed success and Sign in, then posts only `{ "type": "verification-completed" }` on a same-origin BroadcastChannel. No token, receipt, account ID or email is included. A failed/reused token never broadcasts success or renders newly validated success.
- The original tab treats a message only as a hint to recheck its own receipt. Spoofed, stale or unrelated messages cannot directly change verification state. Coalesce hints, allow one in-flight check and throttle requests; never repeat registration.
- While a valid pending receipt is displayed, recheck once on mount, every 15 seconds while visible, on visibility/focus restoration, and through an explicit retry/check action. Stop timers/listeners and cancel/ignore stale requests on unmount, expiry, success, identity/scope change or receipt replacement. No forced focus, tab closure or automatic sign-in.
- Missing BroadcastChannel, suspended tabs, late-opened tabs and verification on another device are covered by visible polling/recheck within the receipt lifetime. A different device can validate the email token but cannot read the original session's receipt. After receipt/session expiry, provide honest sign-in/resend recovery.
- Recheck failure is distinct from verification failure. Preserve the pending context within its absolute lifetime and offer retry. A verification token can be committed successfully even if subsequent session/status synchronization fails.

## Threat and acceptance review

| Case                                                                  | Required result / test                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New registration, valid link in another tab/device                    | Link POST commits first; original receipt later returns verified; both tabs offer Sign in without authenticating.                                             |
| Existing verified/unverified email, arbitrary password                | Same acceptance shape/receipt length/expiry; decoy never exposes existing verification. Avoid claiming constant-time execution beyond current hashing policy. |
| Wrong session, guessed receipt, no pending context                    | No email lookup; generic expired; no account details or session elevation.                                                                                    |
| Spoofed/stale/unrelated broadcast                                     | At most a throttled authorized recheck; no UI success without backend verified response.                                                                      |
| Concurrent registrations/tabs and parallel CSRF requests              | Independent correlations; no overwritten session map; no receipt/account crossover.                                                                           |
| Replay valid receipt                                                  | Read-only status until absolute expiry; no authentication/token consumption or renewed TTL.                                                                   |
| Expired receipt/session, logout/login, lost in-memory context         | No retained authority or false success; clear recovery guidance.                                                                                              |
| Resend, invalid/expired/used/repeated verification token              | Superseded/failed token remains an error; no newly validated success/broadcast. Receipt only reflects authoritative current account state.                    |
| Email change, old email-change link, reset or deletion                | Snapshot email/session version prevents unrelated verification from confirming this registration. Existing revocation remains separate.                       |
| Redis/DB/API failure or verification committed before recheck failure | No guessed success; bounded retry/recovery; no duplicate registration or destructive compensation.                                                            |
| URL and artifacts                                                     | Existing link-token scrubbing retained; no sensitive payload in channels, browser storage, logs or test artifacts.                                            |

IMP-04.02 must add separate backend contract/service tests, frontend gateway/component lifecycle tests and two-page browser tests for the cases above; existing tests remain unchanged. Run existing auth/CSRF/session regressions, generated-contract checks, lint/typecheck/build and available browser checks. Live dependencies and another-device simulation must be distinguished from fixture evidence.

## Approved scope

The owner approved the opt-in registration response and status endpoint, session-bound Redis correlations with a 15-minute absolute lifetime, in-memory-only browser context with explicit reload recovery, 15-second visible polling and the stated rate limits. This authorizes only IMP-04.02 within this mechanism, not password policy, automatic login, schema migrations, email blocking or later plan tasks.

Reference for the session-store comparison: [express-session 1.19.0 documentation](https://github.com/expressjs/session/blob/v1.19.0/README.md), consulted through Context7. Source inspection confirms the current RevocableSessionStore serializes whole session objects; no running-service or migration claim is made here.
