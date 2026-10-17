# AI Slop Detection

Identifies generic AI-generated design patterns:

- Gratuitous gradients on everything
- Purple-to-blue defaults
- "Glass morphism" cards with no purpose
- Rounded corners on things that shouldn't be rounded
- Excessive animations on scroll
- Generic hero with centered text over stock gradient
- Sans-serif font stack with no personality

# File Converter — Design System

> A quiet dark workbench: expressive cream typography, fine outlines, and one clear task.

**Theme:** dark. **UI language:** Ukrainian. **Wordmark:** `converter` (provisional).

This file owns visual rules and essential UI behavior. [technical-task.md](docs/technical-task.md) owns product requirements; [architecture.md](docs/architecture.md) owns implementation and API contracts. Use the supplied GSAP reference for visual inspiration, not as a requirement to copy its branding or effects.

## Visual direction

- Nearly black canvas, warm cream text, generous whitespace, left-aligned headings.
- One bounded conversion workspace; open rows and separators elsewhere.
- Lime signals actions and focus; format colors identify files, not status.
- Outlined pill actions, restrained rectangular fields, sparse bracket annotations such as `{ Як це працює }`.
- Flat, opaque surfaces. No gradients, glass, glow, decorative shadows, blobs, stock imagery, or animation showcases. No GSAP dependency is needed.

## Colors

Change colors here by semantic role; reuse tokens throughout components.

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` | `#0e100f` | Page background |
| `--color-surface` | `#191c19` | Workspace, dialogs, code blocks |
| `--color-surface-hover` | `#232720` | Hover and selected surfaces |
| `--color-text` | `#fffce1` | Primary text and cream outlines |
| `--color-text-muted` | `#b4b5a5` | Secondary text |
| `--color-border-subtle` | `#42433d` | Decorative dividers |
| `--color-border-control` | `#7c8072` | Essential control boundaries |
| `--color-text-disabled` | `var(--color-border-control)` | Disabled labels |
| `--color-accent` | `#abff84` | Primary outline, focus, upload progress |
| `--color-success` | `var(--color-accent)` | Completed state |
| `--color-warning` | `#ffce82` | Expiry and quota warnings |
| `--color-danger` | `#ff9c90` | Errors and destructive actions |
| `--color-format-jpg` | `#ffb56b` | JPG label |
| `--color-format-png` | `#fec5fb` | PNG label |
| `--color-format-docx` | `#77d5ed` | DOCX label |
| `--color-format-pdf` | `var(--color-text)` | PDF label |

Always pair state colors with text or an icon. Do not tint whole sections or body paragraphs by format. Change an alias to an independent token only when its role needs to diverge.

## Typography

**Primary:** [Onest](https://github.com/simpals/onest), weights 400, 500, 600, 700.  
**Technical:** [IBM Plex Mono](https://github.com/IBM/plex), weight 400, for format labels and code.

Self-host WOFF2 assets with their licenses and Ukrainian glyphs. System fonts are loading fallbacks, not the visual identity.

| Role | Desktop / mobile | Weight | Line height |
| --- | --- | --- | --- |
| Homepage display | 96px maximum / 44–52px | 600–700 | 1.02 |
| Page heading | 48px / 32px | 600 | 1.1 |
| Section heading | 32px / 26px | 600 | 1.2 |
| Component heading | 24px / 20px | 600 | 1.25 |
| Intro | 20–24px / 18px | 400 | 1.45 |
| Body and controls | 16–18px / 16px | 400–500 | 1.5 |
| Helper and code | 14px / 14px | 400 | 1.45 |

Headings may use tracking down to `-0.035em`; body text uses normal tracking. Scale display type fluidly, allow natural wrapping, and never clip Ukrainian glyphs. Avoid fixed desktop line breaks on mobile.

## Layout and shape

| Property | Rule |
| --- | --- |
| Content width | Maximum 1280px |
| Page gutters | Desktop 64px; tablet 32px; phone 20px, reducing to 16px at 320px width |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48, 64, 80, 96px |
| Section gap | Desktop 80px; mobile 48px |
| Workspace padding | Desktop 24–32px; mobile 16–20px |
| Header | Approximately 80px desktop / 64px mobile, in normal flow |
| Borders | 1px; dashed only for the dropzone |
| Radius | Fields/code 6px; workspace/dialogs 8px; action buttons 9999px |
| Elevation | Surface steps and borders; no decorative shadows |

Desktop homepage: heading and workspace in two columns, with slightly more width for the workspace. Keep file selection and the main action visible at 1366×768. Start stacking near 1024px; refine navigation and controls near 640px. Treat thresholds as defaults and adapt to content rather than specific devices.

On phones, use a compact heading followed by a full-width converter and vertical instruction steps. File selection must work without dragging. Do not hide errors, authentication guidance, expiry, or download actions to make a layout fit.

## Components

| Component | Visual and interaction rule |
| --- | --- |
| Primary button | Transparent, lime outline, cream label, minimum 48px height; one primary action per task state |
| Secondary / destructive button | Cream outline or text link; danger token and explicit verb for destructive actions |
| Input / select | Solid surface, visible control border, persistent label, inline helper/error |
| Dropzone | Dashed outline, upload icon, file-picker button, supported formats and size limit; stronger outline while dragging |
| File summary / status | Filename, format, size, and relevant action; status uses text plus icon |
| Progress | Thin solid lime bar for measured progress; restrained indeterminate indicator otherwise |
| Toggle | Labeled switch with clear checked, pending, disabled, and error states |
| Dialog | Opaque surface and dark backdrop; accessible title, managed focus, close control |
| File list / code | Hairline-separated file rows; solid code blocks with copy feedback and local horizontal scrolling |

Use Lucide React icons with 1.5–2px strokes and 20–24px visual sizes. Give icon buttons accessible names and at least 44px targets. Keep the same rest, hover, focus-visible, pressed, disabled, loading, and error treatments across screens. Disabled styling changes tokens rather than fading the entire component.

## Homepage

The composition below is the homepage reference. Guest eligibility changes the helper copy and authentication trigger, not the visual system.

1. **Header:** `converter`, `Конвертер`, `API`, `Увійти`. Signed-in navigation exposes `Мої файли` and `Профіль`.
2. **Intro:** `Інший формат. Той самий файл.` Supporting copy: `Зображення та документи — у потрібному форматі.` Show `JPG ↔ PNG` and `DOCX → PDF` as colored text.
3. **Converter:** `Перетягніть файл сюди`, `Вибрати файл`, `JPG, PNG або DOCX · до 20 МБ`, target selector, and `Конвертувати`. Eligible guests see `1 файл безкоштовно без реєстрації`.
4. **Instructions:** `{ Як це працює }` with three open steps: choose a file, select a format and convert, download. The first conversion does not require sign-in.
5. **Retention note and footer:** explain temporary availability; repeat useful navigation only.

Keep the main action disabled until a valid source and target exist. An eligible guest starts the first conversion directly. Once the free conversion succeeds, the next conversion opens authentication before upload: `Безкоштовну конвертацію вже використано. Увійдіть або створіть акаунт, щоб продовжити.` Keep the previous result downloadable until expiry. While a trial job is active, show its state rather than allow a duplicate. No pricing blocks, testimonials, fake metrics, or oversized promotional sections.

## Project-specific UI rules

- **MVP:** one file up to 20 MB; JPG ↔ PNG and DOCX → PDF. Show only targets supported by the source. Do not imply batch upload, cancellation, PDF → DOCX, or unsupported settings.
- **Guest trial:** one successful free conversion per server-tracked guest browser context. Validation and terminal conversion failures do not consume it; reloads and result expiry do not renew it. Read eligibility from the server, not local storage. Do not claim a guaranteed per-person allowance.
- **Progress:** distinguish file selection, upload, queue, processing, completion, and failure. Upload uses actual percentages; queue and processing have no invented percentage, position, or ETA.
- **Result:** show a check, output details, and `Завантажити`. Guest results and account results with auto-save off expire one hour after completion; account results with it on show `Збережено в «Мої файли»`. Use the accepted job's policy and server timestamps. Guests have no auto-save toggle; login does not automatically save their existing result.
- **Auto-save:** account and files views share one setting. Explain that changes affect new conversions and do not remove existing saved files.
- **Authentication and recovery:** keep the selection in memory where possible. If navigation loses it, ask for reselection. Network failure must not appear as conversion failure; resume known jobs without automatically duplicating uploads.
- **Errors and deletion:** explain the cause and next action inline. Confirm destructive actions. Expired or deleted results must not retain a usable download action.
- **API key:** full secret appears only on creation/rotation; later show a masked prefix. Warn that rotation invalidates the old key.
- **Copy:** Ukrainian, concise, specific. Avoid unsupported speed, fidelity, privacy, or “unlimited” claims. Do not expose stack traces or infrastructure details.

Detailed transitions, authorization, retention mechanics, and API behavior remain in the linked product and architecture documents.

## Screen patterns

| Screen | Composition |
| --- | --- |
| Converter | Expressive intro beside one workspace; steps below |
| Sign-in, registration, verification, recovery | Compact 420–480px labeled form, inline feedback, password-manager support |
| Account | Open sections for profile, security, auto-save, and API access |
| My files | Search, format filter, date ordering, paginated rows with details/download/delete; labeled rows on mobile |
| API docs | Readable article, section navigation, endpoint examples and copyable code; placeholders rather than real secrets |

Every data-driven screen needs loading, empty, error, and success states. Separate an empty library from an empty search. Reuse these patterns instead of creating a new visual system per route.

## Accessibility and motion

- Target WCAG 2.2 AA: normal text ≥4.5:1 contrast; large text and essential UI boundaries ≥3:1.
- Support keyboard navigation, visible labels, logical headings, managed dialog focus, and a 2px lime focus ring with offset.
- Announce meaningful status changes; make errors and progress available to assistive technology. Never rely on color, hover, or drag alone.
- Support 200% zoom and reflow at 320px width. Keep essential actions reachable and code overflow within its block.
- Use 120–180ms color/border transitions. Honor reduced motion; no scroll reveals, parallax, animated headings, or decorative loops.

## Keeping this file maintainable

- Edit shared values in the token/type/layout tables; avoid repeating raw values in screen descriptions. Keep aliases only while the roles intentionally match.
- Add a component rule only when an existing pattern cannot cover a real screen. Keep detailed API, state-management, folder, and deployment instructions in `docs/architecture.md`.
- Keep visual references aligned when composition or access guidance changes. Verify rendered desktop/mobile layouts, focus, contrast, and real states during implementation.

Organization follows the practical categories in [Refero DESIGN.md examples](https://styles.refero.design/ai-agents/design-md-examples), adapted to this product rather than treated as a universal format.
