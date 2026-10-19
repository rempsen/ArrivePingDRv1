# ArrivePing notification emails v2: blueprint

**Date:** 2026-10-19 · **Tier:** Standard blueprint, built in the same request · **Status:** Approved scope from Dan (intake answers, 16:07–16:15); Dan asked for it to be built and pushed to every tenant when done.

## Intake (stated vs assumed)

**Stated by Dan:**
- The current branded HTML email is limited.
- He wants a more modern, professional template, a much better core layout and more robust customisation.
- Audit the system, identify modern tools, design a best-in-class notification email, and push it to every tenant.
- Existing designed emails switch to the new layout automatically. The blocks and words stay the same; the frame, type and spacing improve.
- One company theme (colours, font, header, buttons, footer, social links) applies to every email, edited inside the designer.
- Extras for this release:
  - columns and social links;
  - a technician card and an ETA banner;
  - "Describe it, AI drafts it".

**Assumed:**
- No feature switch, because Dan asked for every tenant.
- Dark-mode and inbox previews aren't wanted in v1.
- The renderer is still dark-mode *safe*: it declares a colour scheme, includes dark styles, and avoids colour inversion traps.

## Audit of the current system

| Area | Finding | Impact |
|---|---|---|
| Renderer (`services/email-render.ts`) | Single 580px card with a `box-shadow`, `border-radius` on tables, and `linear-gradient` headers. There are no MSO/Outlook conditionals, no preheader, no `lang`, no `role` on every table and no `color-scheme`. Buttons are not bulletproof, and the details table pads the `<table>` element, which many clients ignore. | The email looks dated, and in classic Outlook, Gmail dark mode and Outlook.com it renders inconsistently. |
| Block set | Seven blocks only: heading, text, button, image, divider, spacer and a detail table. There are no columns, callouts, technician card, ETA, social links or lists. | Every tenant's email looks the same, and "on the way" emails can't show who's coming. |
| Theme | Brand colour, header style and background are set on the Channels tab. The logo is set in both places. Font, button shape, corners and social links don't exist. The server accepts header styles `plain` and `logo`, but the renderer only knows `minimal`. | Customisation is split across two screens and can't be changed much. The schema and renderer have drifted apart. |
| Plain-text emails (`emailHtml` in dispatch) | A second, different frame. It inserts the message into HTML **unescaped**, and its button is hardcoded to white text on the brand colour. | Two looks for one brand. Customer-supplied names can inject markup, and a white brand colour makes the button text unreadable. |
| Editor (`components/email-editor.tsx`) | No drag and drop (the grip icon does nothing), and no undo. Tokens are only appended to the end of the text. The preview is a server round trip on every keystroke, and the canvas isn't clickable. There's no preview-text field. | It's slow and fiddly, and nothing about it says "best in class". |
| Logo upload | Accepts SVG. Gmail and Outlook don't display SVG images. | The logo can be invisible in the most common inboxes. |
| Channels save | The Channels tab PATCHes the whole channel row. | It would overwrite theme edits made in the designer. |

## Tools considered (verified 2026-10-19)

| Option | What it is | Verdict |
|---|---|---|
| **Own block model and a hardened renderer in `shared/email/`** (recommended) | Pure TypeScript, no dependencies. Runs on the server (sends) and in the browser (instant WYSIWYG preview). Uses Good-Email-Code patterns: hybrid fluid columns with MSO ghost tables, a bulletproof button, preheader, `color-scheme`, `role="presentation"`, `lang`/`dir`, explicit image widths and a 600px container. | Chosen. Same tokens, same tenancy, same theme. Zero new runtime dependencies. Can be tested in `bun test`. |
| MJML 5.4.1 (npm latest) | Mature markup-to-email compiler. Tested here in Bun: the **API is async in v5**, it took 1.6 ms per render after a 24 ms cold start, and it installs 195 packages / 56 MB. | Use it instead if we later need marketing-grade, many-column layouts. For now it would force six synchronous call sites to become async and add a large supply chain for a fixed block set. |
| React Email (`@react-email/components` 1.0.12, render 2.1.1) | Thin JSX wrappers that output tables, rendered with react-dom/server. | Our designs are data, not JSX, so it adds little over the hand-rolled kit. Its Outlook handling is minimal. |
| Embeddable editors: Unlayer (embed plans from about $200/month), Topol (from $79/month), Beefree SDK, Stripo plugin | Hosted drag-and-drop builders. | Rejected. The cost is per tenant, they keep their own design format, and brand inheritance and `{{tokens}}` need glue. They also carry a third-party script and CSP risk inside the admin. |
| GrapesJS newsletter preset | Open-source page-builder framework. | Dated email output, and heavy to theme to the ArrivePing UI. |

**Facts relied on:**
- Gmail clips messages over 102 KB.
- About 600px is the safe width.
- Preheaders should be padded with `&zwnj;`/`&#847;`.
- Use `role="presentation"` and `lang`/`dir`.
- Dark mode comes in three behaviours: none, partial and full inversion. Avoid transparent logos on white.
- Classic Outlook (the Word engine) ignores `max-width`, `border-radius` on images and flexbox. It needs `width`/`height` attributes on images.

Sources: prospeo.io/s/html-emails, hackernoon "Why email HTML in 2026 is still a nightmare", sequenzy.com/blog/best-html-email-builders, the npm registry (mjml 5.4.1), and a local Bun trial.

**Knowledge store:** searches for email builders, React Email and MJML returned no relevant practitioner notes. The store has no email-rendering coverage, so this decision rests on vendor docs and the local trial.

## Design

### Data
- **Email design v2**, stored in `notification_rules.email_design` and `email_templates.design`:
  - Shape: `{ "v": 2, "preheader": string, "blocks": Block[] }`.
  - A legacy v1 is a bare array of blocks; it is read as `{v:2, preheader:"", blocks}`.
  - `normalizeDesign()` drops unknown types, bounds every string, and allowlists URLs (`https:`, `http:`, `mailto:`, `tel:`, `/uploads/…` or a single `{{token}}`). It allows at most 60 blocks, with columns two levels deep at most.
- **Blocks:**
  - `heading{text, level 1-3, align}`
  - `text{text with **bold**, *italic*, [link](url) and "- " lists, align, tone normal|muted|small}`
  - `button{label, url, align, variant solid|outline|link, full}`
  - `image{url, alt, width, align, href}`
  - `details{title, rows[], style boxed|lines}`
  - `callout{text, tone info|success|warning|brand}`
  - `eta{label, value, note}`
  - `tech{name, photo, role, note}`: the photo comes from the new `{{techPhoto}}` variable; if there's no photo, initials are shown.
  - `columns{ratio 1:1|1:2|2:1, cols:[Block[],Block[]]}`: leaf blocks only.
  - `social{}`: uses the theme's links.
  - `divider`, `spacer{sm|md|lg}`
- **Company theme:** a new `notification_channels.email_theme` JSON column, plus the existing brand colour, background, logo, logo height, header style and footer.
  - Theme fields: font (system/modern/geometric/rounded/classic), heading weight, corners (sharp/soft/round), button shape (square/rounded/pill), layout (card/flat), header (brand/gradient/light/none), logo alignment, text colour, social links `[{label,url}]` (up to 8) and a "show company footer" toggle.
  - `normalizeTheme()` (via `legacyHeader()`) maps legacy header styles: gradient→gradient, solid→brand, minimal/plain/logo→light.

### Rendering
`renderEmail(design, brand, vars)` produces the full document; the brand carries the theme.

**Head and document frame:**
- `lang`/`dir`, the x-apple meta tags, and `color-scheme: light dark` with `prefers-color-scheme` and `[data-ogsc]` dark styles.
- MSO OfficeDocumentSettings, a hidden preheader, and a 600px container with a ghost table.

**Header and buttons:**
- Header variants:
  - brand: solid brand colour;
  - gradient: with a solid `bgcolor` fallback;
  - light: white with a brand accent bar;
  - none: the logo sits on the page background.
- Text colours are chosen with `contrastText()`, and logos sit on a light plate whenever the header is dark.
- Buttons use the Mark Robbins bulletproof pattern, with `mso-text-raise`.

**Body content:**
- Columns are fluid hybrid inline-block divs inside MSO tables, so they stack under 600px without needing media queries.
- Images carry `width` attributes.
- The footer contains the company footer, the social links as text pills (no third-party logos), and "Sent by Company".

**Plain-message emails:**
- They now go through the same renderer: heading = the event title, text = the message (escaped), a "View details" button and a small details line.
- One look for the whole brand.
- This closes the HTML-injection hole.

### Editor
A full-screen designer with three panes. It reuses the Job Templates patterns.

**Left pane: block palette**
- Always visible.
- Click a block to insert it after the selection, or drag it to an exact spot.

**Centre pane: canvas and preview**
- The canvas is the real email rendered in-page: the same HTML fragments, with container queries for the phone width.
- Click any block to select it. Hover shows a toolbar to move, duplicate or delete, and a handle to drag-reorder (dnd-kit).
- A Desktop / Phone / Preview toggle shows the exact iframe output.

**Right pane: inspector, with three tabs**
- **Block:** the controls for the selected block. Tokens are inserted at the cursor.
- **Email:** subject, preview text, and the starter or template gallery.
- **Theme:** the company-wide look, with a live preview, plus an "applies to every email" note.

**Across the editor:**
- Undo and redo; keyboard shortcuts for undo, redo, duplicate and delete, ignored while typing.
- A local draft per rule.
- Send test, and "Describe it" (AI draft).
- **Save & apply** saves the email and any theme changes together.

**Channels tab:** the old Email branding card becomes a summary with an "Open email designer" link. The Channels save no longer sends the theme fields.

### API
- `GET/PATCH /notif-config/channels` gains `emailTheme`. It is validated by `normalizeTheme`, and the theme fields are removed from the Channels tab's whole-row save.
- `/email/render` and `/email/test` accept a v2 design plus an optional theme override, so the designer can show unsaved theme changes.
- `POST /email/generate {description, event?, recipient?}` returns an AI draft.
  - It is admin-only and limited to 20 drafts per hour.
  - The model's output is schema-constrained and passed through `normalizeDesign`. The description is treated as data.
- `/email/logo` turns away SVG with a plain message.

## Failure handling and safety
- Every send path renders through `normalizeDesign`. A malformed stored design falls back to the plain message in the branded frame, so nothing fails to send.
- Variable values are HTML-escaped. URLs are allowlisted after interpolation; anything else becomes `#`.
- Footer HTML is system-built and remains trusted, as it is today.
- The theme is stored per tenant on a table protected by row-level security, with no new cross-tenant reads.

## Quality
- Unit tests:
  - v1→v2 migration;
  - normalize bounds;
  - escaping and URL allowlisting;
  - contrast;
  - legacy header mapping;
  - size under 102 KB with 60 blocks;
  - MSO and preheader presence;
  - column stacking markup;
  - dispatch plain-message path escaping.
- Route tests:
  - theme PATCH validation;
  - `/email/generate` 400 when there's no description;
  - SVG logo rejected.
- Browser e2e on the demo server:
  - open the designer;
  - drag a block from the palette and reorder it;
  - change the theme;
  - save;
  - screenshots at desktop, iPad and phone.
- Cost: AI drafts use the existing gateway text model, a few cents per draft at most, capped at 20 per hour per admin.

## Rollout
Merge to main. arriveping.com auto-deploys to every tenant. Existing designs re-render in the new frame with their content unchanged. There is one additive migration (0030, the `email_theme` column).

## Risks and open questions
1. Some tenants may prefer the old gradient card. The theme keeps a "gradient" header, so the closest match is one click away.
2. Classic Outlook will show square corners. That's expected.
3. AI drafting can't be exercised locally without an AI key. Dan should try it once on arriveping.com.
