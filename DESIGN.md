# Design: Hisaab

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule. It replaces `docs/mockup.html` as the visual reference.

## System
- Genre: atmospheric
- Shape of the first page: app screen (the project's own top bar, investments first)
- Theme: Refract, water/pool (warm plaster paper, deep pool-blue ink, one blue for action)
- Axes: light/grotesk-sans/cool · posture: restrained
- Signature: the portfolio value set light and large over its performance chart, the one panel per page with the cast shadow
- Modes: light and dark ("pool at night"); cookie `hisaab-theme` sets `data-theme`, otherwise the system decides

## Tokens
`styles/tokens.css` is the source of truth; the names are the project's own. The roles (light):
```css
:root {
  --page: oklch(97.4% 0.007 95);  --surface: oklch(99.7% 0.003 95);  --surface-2: oklch(95.6% 0.011 225);
  --heading: oklch(23% 0.035 245);  --text: oklch(29% 0.035 245);  --text-3: oklch(47% 0.026 240);  --line: oklch(90% 0.009 230);
  --primary: oklch(48% 0.12 236);  --on-primary: oklch(99% 0.003 95);  --primary-soft: oklch(94% 0.026 222);  --focus: oklch(56% 0.14 234);
  --gain: oklch(47% 0.12 152);  --loss: oklch(50% 0.18 27);
  --display: "Funnel Display", sans-serif;  --sans: "Funnel Sans", system-ui, sans-serif;  --mono: ui-monospace (raw SMS and codes only);
  --radius-card: 22px;  --radius-inner: 12px;  --radius-pill: 999px;
  --shadow-card: tinted water shadow down-right;  --shadow-cast: the signature panel only;
}
```
Dark mode keeps every name with new values (page oklch(18.5% 0.022 245), surface oklch(22.5% 0.026 243), primary oklch(79% 0.1 228)). The spacing scale (`--space-3xs` 2px to `--space-2xl` 64px), the fixed type scale (`--text-2xs` 11px to `--text-4xl` 40px, body 15px, table cells 14px), the easing and the durations live in `tokens.css`.

## Type
- Titles and statement figures: Funnel Display 400 (300 for the big figures), tracking -0.032em, sentence case, one colour.
- Everything else: Funnel Sans; labels and table heads 500, a step smaller, `--text-3`, sentence case, never tracked capitals.
- Figures: tabular numerals in the sans, never mono.

## Surfaces
- One container recipe: `--surface`, `--radius-card`, `--edge-light` plus `--shadow-card`, no border, no card inside a card.
- Rules are horizontal hairlines inside tables and lists only.
- Colour: blue only for the primary action, the current place and focus; green and red only for gains, losses and over budget; spending in normal text with a minus; transfers grey.

## Controls
- Primary: `--primary-btn` pill, `--on-primary` text, `--btn-edge` top light, 40px; hover `--primary-btn-hi`.
- Secondary: `--surface` pill with a `--line-strong` hairline, same radius and height.
- Tabs: a `--surface-2` pill track, the current tab a raised white pill. Chips and group tabs: 32px pills, current `--primary-soft`.
- Inputs: white wells, `--field-edge` hairline, `--radius-inner`, notched label, `--focus` ring.

## Motion
- Character: calm. State only: hover lifts a panel 2px and lengthens its shadow, drawers slide, toasts fade; `--dur-micro` and `--dur-short`, transform and opacity. Under reduced motion everything ends at once.

## Exports
`styles/tokens.css` in this project. Tailwind, DTCG or shadcn blocks are added here on request.
