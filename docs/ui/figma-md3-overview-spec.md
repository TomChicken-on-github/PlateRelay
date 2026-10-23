# Figma MD3 概况 (Overview) spec

Read via Figwright from file "PlateRelay", frame `PlateRelay Dashboard Admin` (7:356). Dark MD3 scheme. Values are exact from `get_design_context`; "n/a" = not exposed by the tool.

## Layout
- Frame 1680 × 1096 (minHeight 1080), bg `#141218`, horizontal: nav 200px + workspace (fill, 1480).
- Workspace `调度工作区`: vertical, padding 28 all sides, gap 24 → content width 1424.
  Sections: header (48h) → stat row (166h) → device section.
- Stat row: 3 cards horizontal, gap 12, each flex-grow 1 (≈466.67w).
- Device section: vertical, gap 16 → section header (44h) → masonry.
- Masonry `重点设备组`: 3 fixed columns × 464w, column gap 16; each column vertical, card gap 16.
- Card heights: plain 307; with bottom banner 349 (307 + 42).

## Color tokens (name → hex)
| Token | Hex | Used for |
| --- | --- | --- |
| Surface (frame bg, M3 dark surface) | `#141218` | page bg |
| Schemes/Surface Container | `#211F26` | stat + printer card bg |
| Schemes/Surface Container High | `#2B2930` | account pill bg, 离线 chip bg |
| Schemes/On Surface (M3/sys/dark/on-surface) | `#E6E0E9` | page title, stat value, card title, telemetry text, file name |
| Schemes/On Surface Variant | `#CAC4D0` | stat title/unit/detail/trend, summary line, time line, unselected chip label, 离线 chip label |
| Schemes/Outline | `#938F99` | offline "最后遥测" text |
| Schemes/Outline Variant | `#49454F` | filter-chip stroke (1px inside) |
| Schemes/Primary | `#D0BCFF` | printer/stat icons, percent text, wave + end dot |
| Schemes/Secondary Container | `#4A4458` | selected filter chip bg, progress track |
| Schemes/On Secondary Container | `#E8DEF8` | selected filter chip label + check |
| Schemes/Error | `#F2B8B5` | error banner text/icon, offline dot + text |
| Schemes/Error Container | `#8C1D18` | error banner bg |
| Accents/Orange | `#FF8D28` | nozzle icon stroke |
| Accents/Teal | `#00C3D0` | bed icon stroke |
| (raw) | `#808080` | chamber + layers icon (layers fills at 0.2 opacity) |
| Accents/Cyan | `#00C0E8` | AMS slot ring (A1 sample; per-filament colour) |
| Accents/Green | `#34C759` | AMS active-slot dot |
| Accents/Red | `#FF383C` | 故障 chip label |
| Misc/Buttons/BG - Destructive | `#FF383C24` (14% alpha) | 故障 chip bg |
| (raw) | `#FFFFFF` | AMS label text, owner name |

Status chips (bg / label):
- 打印中: `#213A2D` / `#92D5AB` (raw, not variable-bound)
- 问题: `#3E2D20` / `#F6BA78` (raw)
- 故障: `#FF383C24` / `#FF383C`
- 离线: `#2B2930` / `#CAC4D0`

Banners (`设备安全状态`):
- Warning (问题): bg `#3E2D20`, text + lock icon `#F6BA78`; outline button stroke `#49454F59`, label `#F6BA78`
- Error (故障): bg `#8C1D18` (Error Container), text + error icon `#F2B8B5` (Error)

Offline overlay: dim layer `#1D1B20` (Schemes var …22373) at opacity 0.72; alert stroke rect opacity 0.4, radius 12 (stroke colour n/a).

## Typography (Roboto unless noted; letter-spacing in px)
| Role | Family / weight | Size / LH | Tracking | Style |
| --- | --- | --- | --- | --- |
| Page title 概况 | Noto Sans SC Bold | 32 / 32 | Headline Small var | – |
| Stat title | Medium 500 | 14 / 20 | 0.1 | M3 label/large |
| Stat value | **Inter** Regular 400 | 36 / auto | – | – |
| Stat unit | Regular 400 | 14 / 20 | 0.25 | body/medium |
| Stat detail + trend | Regular 400 | 12 / 16 | 0.4 | body/small |
| Section title 设备状态 | SemiBold 600 | 16 / 24 | 0.15 | title/medium-emphasized |
| Section summary | Regular 400 | 12 / 16 | 0.4 | body/small |
| Card title (machine name) | SemiBold 600 | 16 / 24 | 0.15 | title/medium-emphasized |
| Status chip / filter chip label | Medium 500 | 14 / 20 | 0.1 | label/large |
| Telemetry text | Regular 400 | 14 / 20 | 0.25 | body/medium |
| AMS label (A1 / PLA) | Medium 500 | 11 / 16 | 0.5 | label/small |
| Owner name | Medium 500 | 14 / 20 | 0.1 | label/large |
| File name | Medium 500 | 14 / 20 | 0.1 | label/large |
| Percent | Medium 500 | 14 / 20 | 0.1 | label/large (Primary) |
| Time line | Regular 400 | 12 / 16 | 0.4 | body/small |
| Banner text (warning) | Noto Sans SC Regular | 14 / 16 | 0.4 | – |
| Banner text (error) | Noto Sans SC Bold | 14 / 16 | 0.4 | – |
| Brand subtitle (nav) | Noto Sans SC Regular | 12 | – | – |

CJK font: Noto Sans SC (SIL OFL, variable `wght`) replaces Microsoft YaHei everywhere; Roboto stays the Latin/UI face.
| Offline title 设备已离线 | Bold 700 | 18 / 26 | 0 | – |
| Offline last telemetry | Medium 500 | 14 / 20 | 0 | – |
| Account nickname / role | Medium 14/20 · Regular 12/16 | – | 0 | – |

## Spacing & sizes
Header row
- `赛事上下文` 48h; title text box 225×40. Right tools: horizontal, gap 12, align end/center.
- Notification icon button 48×48 (40 content, r100, icon 24, `#CAC4D0`).
- Account pill 160×48, r24, padding 6/16/6/6, gap 10, bg `#2B2930`; avatar 36×36 r18.

Stat card (MD3 "Stacked card" Filled)
- r12, bg `#211F26`; content vertical, padding 20, gap 10; height 166.
- Title row 20h, space-between, icon 20×20 (Primary). Value row: gap 8, baseline-aligned.

Section header
- 44h, space-between/center; title block vertical, gap 4.
- Filter chips: gap 8, height 32, r8. Selected: padding 6/16/6/8, gap 8, check icon 18. Unselected: padding 6/16, 1px inside stroke.

Printer card
- r12, bg `#211F26`, width 464. Body padding 20 all sides (the X1C card nests it as slot padding-x 20 + inner 20/3/20/3; other cards use plain 20). Body vertical gap 14.
- Header row 32h: space-between/center; name group gap 8, printer icon 20×20.
- Status chip: height 32, r8, padding 6/16 (h), gap 8; hug width (e.g. 打印中 75w, 2-char 61w).
- Media row: 123h, horizontal, gap 16, center-aligned.
  - Camera 220×123, r8 (image fill).
  - Telemetry block 188w = telemetry col 98w + AMS col 90w (no gap).
  - Telemetry col: vertical, gap 6, centred; rows 20h, icon 14×14, icon→text gap 6.
  - AMS col: padding-x 4, vertical gap 6; slot row 20h, padding-x 2, gap 4; ring 14×14 (arc, inner radius 0.75); label boxes 15w + 32w × 13h; active dot 4×4.
- Task block: vertical, gap 4, width 430.
  - Owner row 24h, gap 6; avatar 20×20 r20 (circle).
  - File/percent row 20h, space-between.
  - Progress + time: vertical, gap 4.
- Progress (MD3 Wave, "4 dp"): height 12, padding-left 2, gap 6 between active wave and track.
  - Wave: stroke 4, wavelength 40, wave height 12 (variant props); derived centreline amplitude = (12−4)/2 = 4. Built from 40w segments.
  - Track: 4h, r2, `#4A4458`, vertically centred in 12.
  - End stop dot: 4×4, r26 (circle), Primary, at the right end.
- Bottom banner: 42h, full card width, r12, row at left 12/top 12, gap 10, icon 18×18; text 16h.
  Optional right outline button: XSmall Square, 32h, r12, padding 6/12, 1px stroke `#49454F59`.
- Offline variant: history content group dimmed (opacity n/a); bottom overlay 464×106 with bottom radii 12, vertical, gap 8, centred. Dot 7×7 + text, gap 8; dim layer `#1D1B20` @ 0.72.

## Not exposed / to confirm
- Exact opacity on offline history group and alert-stroke colour (strokes not returned).
- 打印中 / 问题 chip colours are raw hex, not bound to variables.
- Nav column (200w) details not extracted (outside scope).
