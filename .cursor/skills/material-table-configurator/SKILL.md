---
name: material-table-configurator
description: Defines the Material Design 3 (MUI v6) design system, 4-layer field hierarchy, spreadsheet table patterns, dialog ergonomics, and CJK typography rules for the OpenCode configuration editor. Use when building or editing this configurator's tables, dialogs, density, theme tokens, or layout.
---

# OpenCode Modal Configurator Design System & UI Skill

Synthesizes rules from `design-system-architecture`, `ui-ux-pro-max`, `visualize/references/components`, `table-patterns`, `ux-tables`, `visual-qa`, `airtable`, `ibm` (Carbon), and `opencode.ai`. Whenever a generic visual rule conflicts with the backend contract (`frontend/src/types/domain.ts`, `frontend/src/api/bridge.ts`, `useSpreadsheetSelection.ts`), **keep the backend contract** and apply this skill to presentation.

---

## 1. Atmosphere, Identity & Dials

- **Identity**: A precision desktop command center for AI provider and model routing. Combines Airtable's spreadsheet clarity, IBM Carbon's productive token density, and OpenCode's monospace technical honesty within Material Design 3 (`@mui/material` v6).
- **Dials (`taste-skill` calibration)**:
  - `VISUAL_DENSITY: 9` (Cockpit / Productive Data Grid — tight 4px/8px rhythm, zero filler cards, `tabular-nums` & monospace identifiers).
  - `DESIGN_VARIANCE: 2` (Predictable Split-Pane & Structured Forms — strict alignment for rapid scanning).
  - `MOTION_INTENSITY: 2` (Restrained 150ms CSS `transform`/`opacity` feedback; honors `prefers-reduced-motion`).

---

## 2. Semantic Color Tokens (Flat Tonal + 1px Structural Borders)

Follow `visualize/foundations` color priority: **neutral structure → semantic state → stable category**. No gradients, no neon glows, no heavy drop-shadows.

| Role | Token / Value | Usage |
|------|---------------|-------|
| Canvas Background | `#F4F6F9` (`background.default`) | App shell behind panes |
| Primary Surface | `#FFFFFF` (`background.paper`) | Table body, dialog surfaces, inputs |
| Tonal Layer 01 | `#F8FAFC` | Sticky table headers, pane toolbars, collapsed accordion headers |
| Tonal Layer 02 | `#F1F5F9` | Row hover, active splitter bar, read-only metadata bar |
| Text Primary | `#181D26` (`text.primary`) | Primary cell values, labels, dialog titles (WCAG AAA) |
| Text Secondary | `#475569` (`text.secondary`) | Column headers, helper text, secondary captions (WCAG AA ≥ 4.5:1) |
| Text Muted | `#64748B` (`text.disabled`) | `<...>` mixed placeholder, unset hints, timestamps |
| Border Default | `#E2E8F0` (`divider`) | 1px structural pane borders, table gridlines |
| Border Strong | `#CBD5E1` | Input outlines, column resize handles |
| Interactive Primary | `#1B61C9` (`primary.main`) | Primary CTA, active tab indicator, selected cell focus ring |
| Selection Fill | `rgba(27, 97, 201, 0.10)` | `useSpreadsheetSelection` rectangular cell selection |
| Paste-Lock Target | `#0288D1` / `rgba(2, 136, 209, 0.09)` | Locked paste target columns (`isPasteColumn`) + header badge |
| Row Checked Fill | `rgba(27, 97, 201, 0.05)` | Rows checked via leading checkbox |
| Status Success | `#15803D` (bg `#DCFCE7`) | Resolved API key (`resolvable: true`), matched defaults |
| Status Warning | `#B45309` (bg `#FEF3C7`) | Unsaved modifications badge, unresolved env/file secret, mtime conflict |
| Status Error | `#DC2626` (bg `#FEE2E2`) | Validation error, probe failure, invalid JSON |

---

## 3. Typography & CJK Precision (`visual-qa` & `opencode.ai`)

- **UI Sans Stack**: `"Inter Variable", "Inter", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif` with `font-feature-settings: "cv01", "ss03"`.
- **Technical Monospace Stack**: `"Berkeley Mono", "JetBrains Mono", "Cascadia Code", "IBM Plex Mono", "Consolas", monospace`.
  - **Mandatory Monospace Fields**: Provider `key`, `npm`, `options.baseURL`, Model `key`, `id`, `provider.npm`, `provider.api`, secret template tokens (`{env:...}`, `{file:...}`), and all JSON editors.
- **Scale & Numeric Discipline**:
  - Top bar title: `14px` (`weight: 600`); Tabs & Toolbar buttons: `12.5px` (`weight: 500`, `white-space: nowrap`).
  - Table headers: `12px` (`weight: 600`, `color: #475569`, `letter-spacing: 0.02em`, `white-space: nowrap`).
  - Table data cells: `12.5px` (`line-height: 1.35`).
  - Numeric cells (`context`, `output`, `input`, `cost.*`, `timeout`): **right-aligned** in tables (`text-align: right`), `font-variant-numeric: tabular-nums`, formatted cleanly so digits align vertically (`table-patterns`).
- **CJK Line-Breaking Guardrails (`visual-qa`)**:
  - Never allow button labels, `Chip` labels, `Tab` labels, or table headers to wrap onto 2 lines (`white-space: nowrap; flex-shrink: 0`).
  - In dialogs and alerts, use `word-break: break-word` with `line-height: 1.5` so Chinese descenders and punctuation never clip.

---

## 4. Spacing, Split-Pane Layout & Table Mechanics (`ux-tables` & `table-patterns`)

- **Base-4 Spacing**: All paddings and gaps use multiples of `4px` (`4px`, `8px`, `12px`, `16px`, `24px`).
- **Full-Viewport Desktop Shell**:
  - `100vh` (`100dvh`) flex column with `overflow: hidden` on the outer shell:
    1. Top Navigation & Global Status Bar (`44px` compact height):
       - Keep only essential actions: clickable config path badge (toggles inline path bar), `打开` button, reload icon button, model library `Select` (`sources` / `activeSourceId` from `getMetadataStatus()`, currently `models.dev`), compact metadata status chip (`MM-DD HH:mm (count)`), `更新` button calling `bridge.refreshMetadata()`, clear-cache icon button, unsaved `未保存` badge when dirty, and `保存` button.
    2. Resizable Vertical Split Pane (`splitRatio` default `0.40` top / `0.60` bottom, clamped `[0.20, 0.80]`, persisted via `bridge.updateSettings` **only on `pointerup`**).
- **Table Rules (`ProviderTable` & `ModelTable`)**:
  - **No decoration over data**: No zebra striping, no nested card shadows, no centered body text. Use crisp `1px solid #E2E8F0` horizontal row dividers and subtle vertical cell borders (`#EEF2F6`) to support 2-D spreadsheet scanning.
  - **Column Order**:
    - Leading column (`42px` fixed): Row `Checkbox` (multi-row selection).
    - Row Header column (`64px` fixed): Row index + detail trigger handle. **Single-clicking the row header opens `EditDialog`** for both tables (double-clicking a data cell still edits in place).
    - Data columns: `PROVIDER_COLUMN_IDS` (`name`, `key`, `npm`, `baseURL`) and `MODEL_COLUMN_IDS` (`key`, `context`, `output`, `inputModalities`, `outputModalities`, `variants`).
    - Trailing action column (`76px` fixed): Explicit Edit (`编辑`) and Delete (`删除`) icon buttons with `aria-label` and `Tooltip`.
  - **Spreadsheet Selection Contract**:
    - Every data `<td>` MUST have `data-sheet-cell="true"`, `data-row-id={rowKey}`, and `data-col-id={colId}`.
    - Each table's `containerRef` MUST wrap **both its toolbar and its `TableContainer`** so clicking toolbar actions (such as `默认`) does not clear the active cell rectangle before `onClick` runs.
    - Controls inside cells (`input`, `button`, `textarea`, `select`, `label`) automatically bypass drag start.
    - While a cell rectangle (`selection.rect`) is active, automatically check the corresponding left-hand row checkboxes (add those row IDs without clearing previously checked rows when the rectangle disappears) in both tables.
    - Copy/paste explanatory hints (`selection.notice === "copy-needs-single-row"`) trigger a short toast (`Snackbar`), then call `setNotice(null)` — never render a long warning chip in the toolbar.
    - While `selection.lock` is set, show a compact `复制模式` chip indicator in the toolbar and highlight locked columns via cell/header background only. Do not show long lock sentences, column header badges, or exit-lock buttons; `Escape` exits copy mode.
  - **Toolbar Density**:
    - Do not repeat the current provider name chip in the model toolbar (only show the model count chip and compact `复制模式` chip when locked).
    - Keep toolbar buttons short: `ProviderTable` uses `新增`, `编辑`, `删除`, `清选`; `ModelTable` uses `添加`, `新建`, `默认`, `编辑` (never `批改`), `删除`, `清选`.
  - **Column Resizing**: Dragging a column header border resizes the column live in state and calls `bridge.updateSettings` **only on `pointerup`**.

---

## 5. Four-Layer Configuration Hierarchy

### Layer 1: Dual Tables (In-Place & Spreadsheet Editing)
- **Single-click / drag**: Rectangular cell selection (also auto-checks the corresponding row checkboxes).
- **Single-click row number header**: Opens `EditDialog` for that provider or model.
- **Double-click data cell (`name`, `key`, `npm`, `baseURL`, `context`, `output`)**: In-place compact input (`Enter` or `blur` commits, `Escape` cancels).
- **Direct-toggle cells (`inputModalities`, `outputModalities`, `variants`)**:
  - **Modalities (`inputModalities`, `outputModalities`, and EditDialog modality groups)**: Render icon-only toggles (no literal `text`/`image`/`audio`/`video`/`pdf` words next to checkboxes) in `MODALITIES` order with tooltips carrying the modality name. Off = gray (`#94A3B8`); On = distinct semantic color per modality (`text`: `#1B61C9`, `image`: `#15803D`, `audio`: `#7C3AED`, `video`: `#EA580C`, `pdf`: `#DC2626`). Keep modality columns narrow (`136px` default).
  - **Variants (`variants`)**: Render compact checkbox + uppercase word labels (`none`→`NONE`, `minimal`→`MIN`, `low`→`LOW`, `medium`→`MED`, `high`→`HIGH`, `xhigh`→`XHIGH`, `max`→`MAX`) in `VARIANT_ORDER` order with a tooltip showing the full variant key and Chinese meaning. Stored keys in `variants[key]` remain `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
  - Copy/paste serializes as comma-separated tokens.
  - Toggling a known modality checkbox MUST preserve any unknown modality strings already present on that model.
  - Checking a variant adds `variants[key] = existingObj ?? {}` without wiping existing variant properties; unchecking deletes `variants[key]`.
- **Model View Ordering**: Group and sort models for display by first hyphen prefix (`model_prefix`), with a subtle prefix tag chip in the `key` column, **without mutating the underlying `provider.models` array order** unless inserting, renaming, or deleting.

### Layer 2: Edit Dialog — Default Expanded Core Fields
- Supports **Single Edit** and **Batch Edit** (`<...>` mixed-value placeholder when selected rows differ; untouched `<...>` fields preserve each row's existing value on confirm).
- **Dialog Field Ergonomics**: Give text inputs, numeric inputs, `Select` controls, and `Autocomplete` inputs a comfortable height (`padding: 7.5px 10px` on small outlined inputs) and generous grid/stack spacing (`16px`–`20px`) across both core sections and accordions so labels, adornments, and helper texts never feel cramped.
- **Provider Core (6 items)**:
  1. `key` (editable in single mode with uniqueness check; disabled in batch mode showing `已选 N 个提供商`).
  2. `name` (`placeholder="<...>"` when mixed).
  3. `npm` (`Autocomplete freeSolo` with `NPM_PRESETS` and persistent helper text: `/v1/responses 推荐 @ai-sdk/openai；/v1/chat/completions 推荐 @ai-sdk/openai-compatible`).
  4. `options.baseURL` (monospace `TextField`).
  5. `options.apiKey` (visibility toggle eye icon, live status badge via `bridge.describeApiKey` without ever exposing resolved secret values, plus quick-insert menu for `{env:VAR_NAME}` and `{file:~/.secrets/key}`).
  6. `options.setCacheKey` (3-state control: `null` 未设置, `true` 启用, `false` 禁用, plus `<...>` when mixed in batch mode).
- **Model Core (6 groups + clickable `默认: ...` chips from `bridge.matchModelDefaults`)**:
  1. `key` & `name` (side-by-side; `key` read-only in batch mode).
  2. `limit.context` & `limit.output` (numeric inputs + `128K` / `200K` / `1M` quick-fill buttons + default chips).
  3. `modalities.input` (5 horizontal icon toggles with tooltips; off = gray, on = per-modality color; supports `indeterminate` `<...>` per modality in batch mode).
  4. `modalities.output` (5 horizontal icon toggles with tooltips; off = gray, on = per-modality color; supports `indeterminate` `<...>` per modality in batch mode).
  5. `variants` (7 horizontal compact checkboxes with short labels + full-name tooltips in `VARIANT_ORDER` + default variants chip).
  6. `核心能力开关` (`attachment`, `tool_call`, `reasoning`, `temperature` in a 4-column grid; each supports `null` 未设置 / `true` 开启 / `false` 关闭 and `<...>` in batch mode, with clickable default chips).

### Layer 3: Edit Dialog — Collapsed Advanced Accordions (with Active Count Chip)
- Collapsed by default. Display a primary tonal `Chip` (`已配置 N 项`) in the header whenever any field inside is non-empty.
- **Provider Accordions**:
  1. **超时策略 (`timeout` / `headerTimeout` / `chunkTimeout`)**: Each supports `null` (未设置), `false` (显式禁用超时), or non-negative integer `ms`.
  2. **自定义请求头 (`options.headers`) 与扩展参数 (`optionsExtra`)**: Key-value row editor (serialized as `HeaderMap` on save) + JSON editor for `optionsExtra` (structured fields always win on save).
- **Model Accordions**:
  1. **推理参数与思考配置**: `options.reasoningEffort` (`REASONING_EFFORTS`), `options.textVerbosity` (`TEXT_VERBOSITY`), `interleaved` (`null` / `false` / `true` / `INTERLEAVED_FIELDS`), `options.thinking.budgetTokens`.
  2. **最大输入限制与计费价格**: `limit.input` + 2-column `cost` (`input`, `output`, `cache_read`, `cache_write` with `$/1M` adornment and default chips).
  3. **单模型驱动覆盖、请求头与高级 JSON**: `provider.npm`, `provider.api`, `id`, model `headers` key-value editor, unknown `options` JSON editor, and `variants` JSON editor.

### Layer 4: Read-Only Metadata & Lossless Passthrough
- Render `meta` (`family`, `release_date`, `last_updated`, `knowledge`, `open_weights`, `canonical_model_id`, `status`) as a compact read-only subtitle strip below the model dialog header.
- Preserve `document.preserved`, `provider.extra`, `provider.optionsExtra`, `model.extra`, `model.limit.extra`, `model.cost.extra`, `model.provider.extra`, and untouched `model.options` keys across all edits and saves.

---

## 6. Visible States & Error Recovery (`ui-ux-pro-max` & `shadcn-data-table`)

Never render a blank screen or swallow errors:
- **Empty Catalog (`origin === "empty"` or `hint === "catalog_empty"`)**: Show a clear alert explaining that the local `models.dev` catalog has not been downloaded yet, with a primary `立即更新模型库` button calling `bridge.refreshMetadata()`.
- **Catalog Download Failure & Manual Cache Reload**: When `bridge.refreshMetadata()` fails, show manual download instructions next to the error in both the top bar area and `AddModelsDialog`: source URL `https://models.dev/api.json`, destination directory and filename (`api.json`) derived dynamically from `bridge.getAppInfo().catalogCachePath` (instructing the user to create the folder if it does not exist), and a `已放好，重新读取` button calling `bridge.reloadMetadataCache()`. If the file is missing or invalid, surface the returned `status.message` without claiming download success.
- **Catalog Search (`hint === "need_query"`)**: Prompt the user to select a provider or enter a search keyword, or click `加载全部模型` (`includeAll = true`).
- **Probe Failure**: When `probeProviderModels` fails, display the exact error reason and automatically switch/offer the local catalog search tab so the user is never blocked.
- **Save Conflict (`BridgeError.code === "conflict"`)**: Open a dedicated confirmation alert/dialog asking whether to **重新加载外部修改** (`loadConfig`) or **强制覆盖保存** (`saveConfig(doc, true)`). Never force-save without confirmation.
- **Browser File Picker Fallback (`BridgeError.code === "dialog_unavailable"`)**: Reveal an inline file path bar with recent paths (`settings.recentConfigPaths`) so the user can load any config path in browser dev mode.
- **Anti-Patterns (Banned)**: No emojis as icons (use `@mui/icons-material` SVG icons only), no em-dashes in UI labels, no `// TODO` or truncated code.
