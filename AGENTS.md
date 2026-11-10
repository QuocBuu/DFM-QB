# Web agent rules

Scope: this web repository and all descendants. Read `docs/UI_RULES.md` before changing UI;
read `docs/PROTOCOL.md` before changing device commands. Parent firmware safety rules still apply.

## Base UI

- Use Bootstrap **5.3.8** primitives from the committed `dist/vendor/bootstrap.css` subset.
  Add framework components through `ui/bootstrap.scss`; regenerate with `npm run build:ui`.
  Never edit generated vendor CSS or bring in another framework, icon font, CDN or remote font.
- Reuse `dist/ui.js`: `bindTabs`, `hydrateIcons`, `icon`, `LogView`.
  Use the shared `.card`, `.card-header`, `.card-body`, `.page-heading`, `.actions`,
  `.log-panel` and `.log-output` contracts. Do not copy a new implementation for each feature.
- Keep feature controllers separate from protocol/serial code. Layout metadata belongs in
  `dist/flash-layout.js`; render it with `dist/flash-ui.js`. Do not scatter flash offsets in markup.
- New CSS must be readable, use shared tokens and component selectors. No global button hover
  overrides. Define foreground AND background for selected/hover/focus states. Tabs must not
  animate color changes: this caused unreadable transient states.
- Use short headings and action labels. Put explanations in closed `<details class="help">`.
  Keep operation scope, confirmation, progress, errors and recovery action visible.
- Icon-only buttons require `aria-label`, `title`, visible focus and a 38px minimum target.
  Use `data-icon` + `hydrateIcons` (local SVG); don't substitute emoji or unlabeled glyphs.
- Scope each tab controller to its own tablist. Preserve ARIA relations, roving tabindex,
  arrow/Home/End navigation and the selection of nested tabs.
- Respect the container: flex/grid children need `min-width: 0`, scrolling children also
  `min-height: 0`; overflow belongs to the log/table, never the whole page. Do not hide
  body overflow to disguise broken widths. See responsive contracts in `docs/UI_RULES.md`.
- Device/log/API data is untrusted: use `textContent`, never `innerHTML`. Logs use the bounded
  shared viewer (500 lines, 2048 characters/line), with follow and wrap controls.

## Firmware actions

- UI describes a 4 MiB allocation, not measured used/free space. Source of truth is firmware
  `partitions.csv` and `scripts/full_update.py`; offsets and sizes must match those contracts.
- Selecting a region never sends device commands. A region's write icon opens the full-release
  flow; it must not suggest a single-region write. Data regions have no raw restore API.
- Enable only supported operations. NVS + OTA metadata backup is one verified JSON produced
  by the local updater after prepare. Image backup is unsupported; don't fake success or files.
- Preserve release validation, durable backup, download, explicit confirmation, job identity
  and readback. Changing file/port invalidates confirmation and requires prepare again.
- No automatic flash, erase, reboot, serial-port access or real-hardware test as part of UI QA.
  Use browser mocks for updater actions; report mocked vs physical validation separately.
- GitHub Pages is static; local updater access stays on loopback with the existing origin/token
  checks. Do not add CORS workarounds or expose a local backend publicly.

## Verification and delivery

- `npm test`: protocol, serial, flash layout, local asset paths and payload budget.
- `npm ci && npm run build:ui`: only required after framework/source dependency changes.
  Commit generated CSS, the upstream MIT license and `package-lock.json` together.
- `npx playwright install chromium` once, then `npm run test:ui` for UI changes. An existing
  browser can be selected with `UI_BROWSER_PATH=/absolute/path/to/chrome`.
- Check 320/390/768/1440px, selected + hover/focus readability (4.5:1), long logs,
  tab keyboard behavior, demo, and guarded updater interactions. Review screenshots too.
- Runtime assets stay local and relative for GitHub Pages subpaths. Total `dist/` budget:
  160 KiB uncompressed, including framework CSS/license. Raise only with a documented reason.
- Do not change protocol fixtures or relax safety tests to make UI work. Keep diagnostics
  usable offline and distinguish prepared/download-requested/verified from a working device.
