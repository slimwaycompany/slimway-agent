Главный источник правил — docs/modules/ui.md

# Design System — SlimWay Agent

## Palette

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| --primary | #02BDB6 | #02BDB6 | Brand, active states, links |
| --accent | #263CD9 | #4f63e7 | Buttons, secondary brand |
| --bg | #eef2f7 | #0d1117 | Page background |
| --surface | #ffffff | #161b22 | Cards, panels |
| --surface-2 | #f7f8fc | #1c2130 | Nested surfaces |
| --text | #1a202c | #e2e8f0 | Primary text |
| --text-2 | #64748b | #94a3b8 | Secondary text, labels |
| --border | rgba(0,0,0,0.08) | rgba(255,255,255,0.08) | Dividers, outlines |
| --glass | rgba(255,255,255,0.72) | rgba(20,28,44,0.72) | Glassmorphism panels |
| --danger | #ef4444 | #f87171 | Errors, destructive |
| --success | #16a34a | #4ade80 | Confirmations |
| --warn | #f59e0b | #fbbf24 | Warnings |

Do not replace: funnel stage colors, lead tag colors, TV screen palette.

## Typography

Font: Manrope (Google Fonts). No other fonts.

| Scale | Size | Weight | Usage |
|-------|------|--------|-------|
| --text-xs | 13px | 400 | Min allowed size |
| --text-sm | 14px | 400 | Secondary, labels |
| --text-base | 16px | 400 | Body |
| --text-md | 17px | 600 | List rows, card titles |
| --text-lg | 20px | 700 | Screen headings |
| --text-xl | 22px | 700 | Metric numbers |

Rule: never below 13 px. Input fields: 16 px minimum (prevents iOS zoom).

## Spacing

8-point grid: 4, 8, 12, 16, 20, 24, 32, 40, 48.

Page edge: 12 px on phone, 16 px on tablet, 24 px on desktop.

## Radii

| Token | Value | Usage |
|-------|-------|-------|
| --r-sm | 8px | Badges, tags |
| --r-md | 12px | Cards, inputs |
| --r-lg | 16px | Modals, panels |
| --r-full | 9999px | Pills, chips |

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| --shadow-sm | 0 1px 3px rgba(0,0,0,0.08) | Subtle elevation |
| --shadow-md | 0 4px 16px rgba(0,0,0,0.12) | Cards, dropdowns |
| --shadow-lg | 0 8px 32px rgba(0,0,0,0.16) | Modals, sheets |

## Motion

Tokens: --duration-fast: 120ms; --duration-base: 200ms; --ease-out: cubic-bezier(0.16,1,0.3,1).
Slide-in sheets: translateY(100%) → translateY(0) in --duration-base.
Toast fade: opacity 0→1 in --duration-fast.
Button :active: scale(0.97) in --duration-fast.

## Breakpoints

≤640: phone — стек, full-width, нижняя панель
641–1024: tablet — гамбургер оболочки, мобильная вёрстка внутри вкладок
>1024: desktop — вкладки сверху, боковые панели разделов

## Icons

Library: lucide-react (React). SVG sprites for shell (non-React).
Never use emoji as functional icons in UI.

## Components

Mode: Operate (task completion interface).
Glass panels: backdrop-filter: blur(12px) + background var(--glass).
Sheets (bottom): Modal on phone, centered dialog on desktop.
Toast: top-right on desktop, top-center on phone. Auto-dismiss 3–4 s.
Input: border-radius var(--r-md), font-size 16px on phone.
Button height: 48px primary, 40px secondary, 32px compact.
Tap target: min 44×44px.
