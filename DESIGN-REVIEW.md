# PumpLaunchBot dashboard — design review

**Reviewer:** design/UI child agent (CatWithClawAi), 2026-10-23.
**Scope:** the 14 files listed in the brief, nothing else. **No application file was modified.** Nothing was run (no npm, no build, no restart) — every claim below is read from the source on disk or from the already-built CSS in `.next/dev/static/chunks/`.
**Mode:** Operate. This is app UI where the user completes a task (launch a coin, read a treasury, audit a bot answer). Ambition here shows as precision and restraint, not expression. The existing dark palette (`#08090a` canvas, `white/[0.02]` cards, 1px `white/10` borders) is kept — the app is deliberately Linear-styled (`#5e6ad2` is Linear's brand indigo), and the palette is not the problem. The problems are the cascade, the hierarchy, and the fact that every card is hand-rebuilt.

**Snapshot (sha256[:12]) — line numbers below refer to these files:**

| file | hash |
|---|---|
| `src/app/layout.tsx` | `37e67e264934` |
| `src/app/page.tsx` | `f23a0e9fe8dc` |
| `src/components/nav.tsx` | `010e7e7482b8` |
| `src/app/globals.css` | `769edf77bd0d` |
| `src/app/launch/page.tsx` | `18b1c8996790` |
| `src/app/launch/launch-form.tsx` | `b152817185b6` |
| `src/app/explore/page.tsx` | `64ee856057d1` |
| `src/app/agents/page.tsx` | `d6c87e42e74a` |
| `src/app/agents/agent-chat.tsx` | `2b68ba6659e9` |
| `src/app/vault/page.tsx` | `f3af8c38e583` |
| `src/app/settings/page.tsx` | `ed528d10bceb` |
| `src/app/launched/page.tsx` | `667131435fa2` |
| `src/app/loading.tsx` | `c50f2ea9b1f2` |
| `src/app/error.tsx` | `656c933bb96c` |

`src/app/launched/page.tsx` changed on disk during this review (18 lines → 108 lines, mtime 21:48). The review uses the 108-line version. If the parent keeps editing `src/app/launched/page.tsx` and `src/app/launch/launch-form.tsx` in parallel, re-check the hashes before applying line-precise edits.

Measured contrast ratios below are computed against the real backgrounds: canvas `#08090a` (18.73:1 for `#f7f8f8`), card `white/[0.02]` over canvas ≈ `#0d0e0f`, input `white/[0.03]` over canvas ≈ `#0f1011`. WCAG thresholds: 4.5:1 body text, 3:1 non-text/UI boundaries.

---

## 1. Hierarchy and layout — by impact

### 1.1 [BLOCKER] The dark canvas is not actually the canvas in light mode

`src/app/globals.css:22-26`

```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}
```

with `:root { --background: #ffffff; --foreground: #171717 }` at `globals.css:3-6` and a `prefers-color-scheme: dark` override to `#0a0a0a` / `#ededed` at `globals.css:15-20`.

`src/app/layout.tsx:30` tries to fix this with utilities: `<body className="min-h-full flex flex-col bg-[#08090a] text-white">`.

It loses. Measured in the built stylesheet (`.next/dev/static/chunks/src_app_globals_css_css_1igg3k2-ikub5._.single.css`):

- `.bg-\[\#08090a\] { background-color: #08090a; }` is at **line 721**, inside `@layer utilities { … }` (the layer opens at **line 331**).
- `:root { --background: #fff; --foreground: #171717 }` is at **lines 1344-1347**, the `@media (prefers-color-scheme: dark)` override at **1349-1354**, and `body { … }` at **lines 1356-1360** — all at top level, unindented, *after* the utilities layer closes at **line 1342**.

Unlayered CSS declarations beat layered ones in the cascade (CSS Cascade 5 §6.4.2) regardless of specificity. So on a browser that does not prefer dark:

| what | written as | actually renders |
|---|---|---|
| page canvas | `bg-[#08090a]` (layout.tsx:30) | `#ffffff` |
| inherited text | `text-white` (layout.tsx:30) | `#171717` |
| typeface | Geist via `--font-geist-sans` (layout.tsx:28, globals.css:11) | **Arial** |

Consequences, all measurable:

- Body copy `text-white/60` (`page.tsx:42`, `launch/page.tsx:12`, `explore/page.tsx:59`, `agents/page.tsx:11`, `vault/page.tsx:38`, `settings/page.tsx:18`, `launched/page.tsx:28`) = white at 60% over white = **1.00:1 — invisible**.
- Card borders `border-white/10` = 1.24:1 over the canvas, ~1.09:1 over white — invisible.
- Card surfaces `bg-white/[0.02]` — invisible on white.
- The sticky header stays dark (`nav.tsx:25` sets `bg-[#08090a]/90` on the header element, which has no competing unlayered rule). Result: dark header, white page, invisible card text — on every route.

Only `font-mono` text escapes the Arial override (it resolves `var(--font-geist-mono)` from the utility layer), so mint addresses and `pre` blocks render Geist Mono while everything around them renders Arial. `--default-font-family: var(--font-geist-sans)` exists in the compiled theme layer but nothing applies `font-sans` to the body.

This is the first thing to fix, and it is a one-block change (§5.1).

### 1.2 The home page has no primary action

`src/app/page.tsx:48-59`: six cards, all identical —

```jsx
className="group rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.04] focus-visible:border-[#5e6ad2] focus-visible:outline-none"
```

Same `text-sm font-medium` title (:55), same `text-xs leading-relaxed text-white/55` body (:56), same border, same padding. "Launch" — the only thing a new user should do — has exactly the weight of "Settings". The `group` class on :53 is dead: no descendant uses `group-hover:`.

Meanwhile the home `<h1>` is `text-2xl font-semibold tracking-tight sm:text-3xl` (`page.tsx:39-41`) while every tab's `<h1>` is `text-xl font-semibold tracking-tight` (`launch/page.tsx:11`, `explore/page.tsx:58`, `agents/page.tsx:10`, `vault/page.tsx:37`, `settings/page.tsx:17`, `launched/page.tsx:27`) and the error boundary's is `text-lg` (`error.tsx:18`). Three title sizes across a six-tab app, and the biggest one is on the page with the least to do.

### 1.3 Product copy is internal roadmap copy

- `page.tsx:61-63`: *"Phases: 1 data layer · 2 metadata + wallet + shell · 3 launch flow · 4 fee sharing · 5 vanity grinding · 6 tracking · 7 bot brain · 8 deploy."* — a build plan rendered as user-facing text, in `text-xs text-white/40` (3.76:1).
- `launch/page.tsx:60-67`: *"Not wired yet: the create transaction, the fee-sharing transaction and the grind step — Phase 3-5. Nothing on this page sends a transaction today."*
- `settings/page.tsx:30-33`: *"Editing these in the UI (with validation against the 10000-bps rule) lands in Phase 4…"* — the one sentence a user needs (why nothing is editable) is last and phrased as a schedule.
- `explore/page.tsx:141-144`: *"metadata: … · data layer phase 1-2 (DexScreener + Helius DAS)"* — vendor names in a footnote.
- `launched/page.tsx:7-13` carries the same narrative in a file comment (fine — comments are for us), but the rendered copy at :36-38 is now clean ("The record is written on a confirmed launch, never before"), which is the standard the other four should meet.

### 1.4 The launch-mode chooser is not a control

`src/app/launch/page.tsx:32-58` renders a `<section>` titled "Launch mode" (`:33`) with two boxes:

```jsx
<div className="rounded-md border border-white/10 p-3">   // :35 and :41
```

They look exactly like the interactive cards on the home page (`page.tsx:53`) minus the hover, but they are plain `div`s: no `input`, no `role="radio"`, no selected state, no handler. The copy at `:36` and `:43` describes the two modes as choices. The form below never reads a mode: `launch-form.tsx:96` hard-codes `creator: address, user: address`. So the highest-level decision in the product is decoration, and the actual gating sentence lives in a `text-[10px]` badge (`:44`) — the smallest text in the app carries the most consequential constraint (`text-[10px]` occurs exactly once in the codebase, here).

### 1.5 Explore: results are one undifferentiated block, and the empty state does not exist

`src/app/explore/page.tsx:88-145` puts a token's identity, four market numbers, link chips and a metadata footnote into a single `p-5` panel with no internal hierarchy. The stat grid (`:111-123`) gives every number the same treatment:

```jsx
<div className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
  <dt className="text-white/40">{k}</dt>
  <dd className="mt-1 font-medium">{v}</dd>
```

so `Price: $0.0000001` and `DEX: raydium` are typographically equal, and the *label* of each stat is the lowest-contrast text on the page (`text-white/40` = 3.76:1 at 12px). Before a lookup there is no empty state at all — `:59-62` is intro prose and then a form; the only instruction is the placeholder (`:68`), which is 2.58:1.

### 1.6 Vault: six equal numbers, and the one that matters is second

`src/app/vault/page.tsx:26-33` builds six cards through one map (`:44-58`), so "Treasury address" (`:27`, a 44-character base58 string) and "Live balance" (`:28`) get the same `p-4` card, the same `dt text-xs text-white/40` (`:47`), and the same `dd mt-1 break-all font-mono text-sm` (`:48`). Everything is mono at 14px. The user comes for the balance and the shortfall; both are visually identical to "Payer reserve (kept by the wallet)" (`:31`).

### 1.7 Settings reads as a receipt

`src/app/settings/page.tsx:22-29` — one `divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10` with six rows of `dt text-sm` / `dd font-mono text-xs text-white/55`, no grouping, no per-row status, no distinction between "configured", "default" and "hard-coded". Values that are environment-derived and values that are design decisions sit in the same column at the same weight.

### 1.8 Launched: the useful thing is below the empty thing

`src/app/launched/page.tsx` now has two subjects: the platform's own launches (`:33-39`, an empty state) and a live SolanaTracker feed (`:41-105`). The empty state is first and occupies the first screen; the live data the page is named for starts under it. The section heading for the live feed (`:43`) is `text-sm font-medium` — the same class as every panel heading in the app, including `launch/page.tsx:33`, `launch-form.tsx:159`, `launch-form.tsx:230`, `agent-chat.tsx:77` and `vault/page.tsx:63` — so "the main content of this page" and "a card title" are the same size. The bucket label (`:59`) is the only uppercase label in the codebase: `text-xs uppercase tracking-wide text-white/40`.

### 1.9 Launch form: a real sequence rendered without sequence

`launch-form.tsx:196-222` puts the three steps in one `flex flex-wrap gap-2` row:

```jsx
className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"   // :201, "1 · Pin metadata"
className="rounded-md bg-[#5e6ad2] px-3 py-2 text-sm font-medium hover:bg-[#4f59b8] disabled:opacity-40" // :209, "2 · Prepare + simulate"
className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"   // :217, "3 · Sign & send"
```

Steps 1 and 3 are ghost buttons; step 2 is the only accent surface. But step 2 spends nothing and step 3 spends real rent (`:223-226`) — the emphasis is on the wrong step. The gating explanation is `text-[11px] text-white/35` (3.12:1, `:223`). `title` (`:218`) is the only disclosure that step 3 is inert.

### 1.10 Layout drift between tabs

| | container |
|---|---|
| `page.tsx:38`, `loading.tsx:3` | `max-w-6xl` |
| `launch/page.tsx:10` | `max-w-5xl` |
| `explore/page.tsx:57`, `agents/page.tsx:9`, `vault/page.tsx:36`, `launched/page.tsx:26` | `max-w-4xl` |
| `settings/page.tsx:16`, `error.tsx:17` | `max-w-3xl` |

Four widths means the content edge jumps on every tab change. Worse, `loading.tsx:6-10` renders the *home page's* 6-card skeleton for **every** route, so `/settings` (a 6-row list) and `/explore` (a form) both flash a 3-column card grid before their real shape arrives.

---

## 2. Typography, spacing, colour, depth

### 2.1 Typeface — two faces, one of them accidental

Arial for all text (`globals.css:25`), Geist Mono for `.font-mono` elements (`launch-form.tsx:188/232/240`, `explore/page.tsx:70/102`, `vault/page.tsx:48`, `launched/page.tsx:76`, `settings/page.tsx:26`, `agent-chat.tsx:78/106`). The Geist Sans that `layout.tsx:8-11` loads is never applied to anything. `tracking-tight` appears only on `<h1>` (`page.tsx:39`, and 6 tab pages), i.e. Tailwind's default `-0.025em`; there is no size-scaled tracking, which is the one typographic move that makes Linear/Vercel headlines read as engineered rather than as default sans.

### 2.2 Type scale — six sizes, no 13px step, five sub-13px uses

`text-base` (:99 explore), `text-sm` (14px, the workhorse), `text-xs` (12px), `text-[11px]` (**15 usages** — `launch-form.tsx:223,232,240`, `explore/page.tsx:102,141`, `agent-chat.tsx:78,101,106,155`, `vault/page.tsx:69,81`, `launched/page.tsx:44,76,78`, `error.tsx:23`), `text-[10px]` (once, `launch/page.tsx:44`). Body is 14px and then it drops straight to 12 — there is no 13px metadata step, so metadata and micro-labels share the same size and are separated only by opacity, at exactly the sizes where opacity hurts legibility most.

Heading roles: `<h1>` `text-xl font-semibold tracking-tight` (6 files); all `<h2>` are `text-sm font-medium` (`launch/page.tsx:33`, `launch-form.tsx:159`, `launch-form.tsx:230`, `agent-chat.tsx:77`, `vault/page.tsx:63`, `vault/page.tsx:75`, `launched/page.tsx:43`); the single `<h3>` is the uppercase bucket label (`launched/page.tsx:59`). A card heading and a page-section heading are the same size as a nav link's text.

### 2.3 Spacing — the first block after the intro has four different values

`mt-8` (`page.tsx:48`, `launched/page.tsx:41`), `mt-6` (`launch/page.tsx:17`, `launch/page.tsx:32`, `launch-form.tsx:157`, `explore/page.tsx:88`, `agents/page.tsx:16`, `agent-chat.tsx:75`, `vault/page.tsx:44`, `vault/page.tsx:61`, `launched/page.tsx:33`, `settings/page.tsx:22`), `mt-5` (`explore/page.tsx:64`), `mt-4` (`error.tsx:23`).

Card padding for the same surface role: `p-4` (7 sites), `p-5` (5 sites), `p-6` (`launched/page.tsx:33`). Inner boxes: `p-2.5` (`explore/page.tsx:118`), `p-3` (`launch/page.tsx:35,41`, `launch-form.tsx:240`, `agent-chat.tsx:97`, `launched/page.tsx:50,64`). Only the last line before the page bottom is consistent (`py-10` everywhere), and `px-4 py-10` never varies even on the 3xl pages.

### 2.4 Colour — the depth direction flips between pages

Surface steps in use, all hand-written: `white/[0.02]` (12 sites), `white/[0.03]` (inputs + one avatar placeholder, `launched/page.tsx:69`), `white/[0.04]` (hover, `page.tsx:53`), `white/5` (hover, nav + buttons), `white/10` (active tab `nav.tsx:46`, badge `launch/page.tsx:44`), `black/30` (`agent-chat.tsx:97`), `black/40` (`launch-form.tsx:240`).

`white/[0.02]` over `#08090a` makes a surface *lighter*; `black/30` and `black/40` make one *darker*. So "recessed" means two opposite things in the same product, and the two inset boxes are on the two most comparable surfaces (a build log and a chat answer). Linear's model is the opposite: elevation is *only* upward luminance stepping (0.02 → 0.04 → 0.05) plus an inset shadow for genuinely recessed panels — never a darker fill.

Accent literals are hard-coded, not tokens: `#5e6ad2` (5 sites: `nav.tsx:28`, `page.tsx:53`, `launch-form.tsx:209`, `explore/page.tsx:75`, `agent-chat.tsx:142`), `#4f59b8` (3), `#828fff` (2), `#08090a` (2). `globals.css:8-13` maps only `background`, `foreground`, `font-sans`, `font-mono`. There is no single place to change the accent, and no way for a component to say `bg-accent`.

Accent usage is otherwise disciplined: it is only on the primary CTA, the focus border and the brand dot — which is correct (Linear reserves brand indigo for interactive/CTA elements). But the **active nav tab** uses `bg-white/10 text-white` (`nav.tsx:46`) — the selected state of the top-level navigation has no accent and no indicator at all beyond a slightly lighter pill.

Status colour: `emerald-300` / `amber-300` / `red-300` / `red-200` are text colours only (`launch-form.tsx:235`, `vault/page.tsx:64,76`, `launched/page.tsx:50`, `explore/page.tsx:82`, `error.tsx:23`, `agent-chat.tsx:107`). All of them are accompanied by words ("passed"/"failed", "ok"/"fail", "unavailable"), so WCAG 1.4.1 is satisfied by copy — this is **fine**, do not add icons on my account. There is no dot, rule or surface to bind a status to a row, which is the only real gap.

### 2.5 Depth — consistent, and should stay that way

No shadows anywhere; depth is borders + surface luminance, which is exactly right for this style. The only elevation cue is the sticky header's `bg-[#08090a]/90 backdrop-blur` (`nav.tsx:25`). Keep it; do not introduce shadows.

### 2.6 The card/panel style is hand-rebuilt 27 times — exact extraction map

| recipe | count | sites | becomes |
|---|---|---|---|
| `rounded-lg border border-white/10 bg-white/[0.02]` | **12** | `page.tsx:53`, `launch/page.tsx:23`, `launch/page.tsx:32`, `launch-form.tsx:158`, `launch-form.tsx:229`, `explore/page.tsx:88`, `agents/page.tsx:22`, `agent-chat.tsx:75`, `vault/page.tsx:46`, `vault/page.tsx:62`, `vault/page.tsx:74`, `loading.tsx:8` | `<Card>` (variants `p-4` / `p-5`) |
| `rounded-md border border-white/10 …` inner box | **9** | `launch/page.tsx:35`, `launch/page.tsx:41`, `launch-form.tsx:153`, `launch-form.tsx:240`, `explore/page.tsx:70`, `explore/page.tsx:95`, `explore/page.tsx:118`, `agent-chat.tsx:97`, `agent-chat.tsx:137` | `<Card variant="inset">` / `<Field>` |
| `bg-white/[0.03]` input recipe (3 divergent copies) | 3 | `launch-form.tsx:153` (`w-full … text-sm`), `explore/page.tsx:70` (`min-w-0 flex-1 … font-mono text-xs`), `agent-chat.tsx:137` (`min-w-0 flex-1 … text-sm`) | `<Input>` |
| primary accent button (3 divergent copies) | 3 | `launch-form.tsx:209` (`px-3`, `disabled:opacity-40`, **no focus ring**), `explore/page.tsx:75` (`px-4`, `transition-colors`, focus ring, `disabled:opacity-50`), `agent-chat.tsx:142` (same as explore) | `<Button variant="primary">` |
| secondary/ghost button (3 divergent copies) | 4 | `launch-form.tsx:189` (`px-3 text-xs`, **no `py`** → 28px tall in a row with a 34px input), `launch-form.tsx:201`, `launch-form.tsx:217`, `error.tsx:30` | `<Button variant="secondary">` |
| chip/tag with link styling (4 copies, 3 text colours) | 4 | `explore/page.tsx:133` (`text-white/70`), `agent-chat.tsx:155` (`text-[11px] text-white/55`), `launched/page.tsx:83` (`text-white/60`), `launched/page.tsx:91` (+ `hidden … sm:block`) | `<Chip>` |
| error/notice alert (2 paddings, 2 tones) | 3 | `explore/page.tsx:82` (`p-3`, red), `agent-chat.tsx:123` (`p-2`, red), `launched/page.tsx:50` (`p-3`, amber) | `<Alert tone="error" \| "warn">` |
| page shell `mx-auto max-w-* px-4 py-10` + `<h1>` | **8 + 6** | all pages (`page.tsx:38`, `launch/page.tsx:10`, `explore/page.tsx:57`, `agents/page.tsx:9`, `vault/page.tsx:36`, `settings/page.tsx:16`, `launched/page.tsx:26`, `loading.tsx:3`) | `<PageShell maxWidth title>` |

Land these as `src/components/ui/{card,button,input,field,alert,chip,page-shell}.tsx` (plus a `cn()` helper) and keep the tokens in `globals.css`. That single move removes the *drift* — not just the duplication — which is the actual damage here: `disabled:opacity-40` vs `opacity-50`, `p-2` vs `p-3`, `text-white/70` vs `/55`, a focus ring on two of three primary buttons, and a secondary button missing its vertical padding.

---

## 3. Mobile at 390px — per file

1. **`nav.tsx:33-54` — the tabs are cut off with no scroll affordance.** The strip is `overflow-x-auto … [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`. Tab widths at `text-sm` with `px-3` (`:44`): Launch ≈74, Explore ≈78, Launched ≈85, Agents ≈74, Vault ≈66, Settings ≈80 → **≈457px + 20px of `gap-1` ≈ 477px** inside a row whose budget at 390px is 390 − 32 (`px-4`, `:26`) − ~10 (brand dot, `:28`; the wordmark is `hidden sm:inline` at `:29`) − 12 (`gap-3`) − the wallet button. Settings is not reachable without an unhinted sideways swipe.
2. **`nav.tsx:56` — the wallet button eats the rest of the row.** `[&_.wallet-adapter-button]:!h-9 [&_.wallet-adapter-button]:!text-sm` only overrides height and font size. The vendor sheet (measured at `.next/dev/static/chunks/[root-of-the-server]__0w9gyucv12nr1._.css:1594-1612`) keeps `padding: 0 24px`, `font-family: DM Sans, …`, `border-radius: 4px`, and `.wallet-adapter-button-trigger { background-color: #512da8 }` → a 48px-padding, purple, DM Sans button on every page, in every viewport.
3. **`page.tsx:48` — 6 cards, 1 column, ~2.5 screens.** `sm:grid-cols-2 lg:grid-cols-3` collapses at 390 to a stack of `text-xs leading-relaxed` cards (`:56`) with no visual break between them.
4. **`launch-form.tsx:187-192` — the mint field cannot show the address.** The input is `w-full … font-mono text-xs`; available width ≈ 390 − 32 (`px-4`) − 40 (`p-5` ×2) − 78 ("generate" button, `:189`) − 8 (`gap-2`) ≈ **232px**, while 44 mono characters at 12px ≈ **290px**. The address scrolls inside the field with no truncate/reveal affordance (inputs scroll, they do not wrap).
5. **`launch-form.tsx:196-222` — the 1→2→3 sequence wraps into 2 rows + 1.** At 390 the three buttons (≈132 / ≈172 / ≈118px + 8px gaps) break after step 2, so the sequence reads "1 2 / 3".
6. **`launch-form.tsx:240-242` — the build log is below the fold.** `mt-6 grid … lg:grid-cols-[1.1fr_1fr]` (`:157`) stacks the log under a full form on mobile; pressing "1 · Pin metadata" produces output the user cannot see. The `max-h-80 overflow-auto` `pre` also creates a nested scroll area inside the page scroll.
7. **`explore/page.tsx:99-102` — hard horizontal overflow.** The mint is `<p className="mt-1 font-mono text-[11px] text-white/40">{token.mint}</p>` with **no `break-all` and no `truncate`**, inside a `min-w-0` flex child (`:98`) next to a 64px image (`:95`). Available ≈ 390 − 32 − 40 − 64 − 16 ≈ **238px** vs ≈ **290px** of 11px mono → the string overflows the card and the page scrolls sideways. Contrast the two places that got this right: `vault/page.tsx:48` (`break-all`) and `launch-form.tsx:232` (`break-all`). This is the one hard mobile break in the app.
8. **`explore/page.tsx:68` — the placeholder is the only instruction and it does not fit.** A 44-character example address at `text-xs font-mono` truncates mid-string at 390, so the example is unreadable exactly where it is needed.
9. **`explore/page.tsx:111` — the stat labels are the worst-contrast text on the page.** `grid-cols-2 sm:grid-cols-4` is fine; `dt className="text-white/40"` (`:119`) at 12px = 3.76:1.
10. **`explore/page.tsx:126-138` — link chips wrap into 2-3 ragged lines each** (`:135` slices URLs to 28 chars) inside `flex flex-wrap gap-2`.
11. **`agent-chat.tsx:148-160` — the suggestion chips are sentences.** Four prompts at `text-[11px]` in `rounded border border-white/10 px-2 py-1` pills; the longest (`:15`, 73 chars) wraps to ~4 lines inside a pill on a 390px column. They read as paragraphs, not buttons.
12. **`agent-chat.tsx:83` — nested scroll on a phone.** `max-h-[26rem] space-y-4 overflow-y-auto pr-1`, plus `scrollIntoView({ behavior: "smooth" })` at `:64` fighting the page scroll.
13. **`vault/page.tsx:44-58` — correct.** One column, `dd break-all font-mono text-sm` (`:48`) wraps the 44-char address to two lines. The only place in the app that handles a long address properly.
14. **`launched/page.tsx:64-77` — the name and mint truncate to ~5 characters.** Row = 32px avatar (`:67`) + 12 + 12 + two chips (`:78`, ≈112px) + `p-3` ×2 (24) = **≈192px reserved of 358 available**, leaving ~166px for `truncate text-sm` name (`:72`) **and** `truncate font-mono text-[11px]` mint (`:76`). The `chart` chip is `hidden … sm:block` (`:91`), which helps, but the row still reads `pu…` / `4Xf…` on a phone.
15. **`settings/page.tsx:24-26` — borderline overflow.** `dd font-mono text-xs text-white/55`: the longest value (49 chars ≈ 323px, `:9`) inside 390 − 32 − 32 = 326px fits by one character. Add `break-words`/`max-w-[46ch]` before someone adds a longer gateway URL.
16. **`loading.tsx:6-9` — the wrong skeleton shape at 390** (1 column of 6 cards) for every route including `/settings` and `/explore`.
17. **`error.tsx:17-33` — mobile-fine** (`max-w-3xl`, `px-4`, `whitespace-pre-wrap` + `max-h-64` `pre`).
18. **All pages: `py-10` (`page.tsx:38` and 7 others) under a 56px sticky header** puts the first heading ~150px down on a phone. `py-6 sm:py-10` reclaims a third of the first screen.

---

## 4. States — per component

Legend: ✓ present, ✗ missing, ~ present but wrong (reason given).

| component | hover | focus-visible | active/pressed | disabled | loading | empty | error |
|---|---|---|---|---|---|---|---|
| nav tab, `nav.tsx:40-52` | ✓ `hover:bg-white/5 hover:text-white` (`:47`) | ~ non-active branch only (`:47`); active tab defines none → UA ring | ✗ | n/a | n/a | n/a | n/a |
| nav brand link, `nav.tsx:27` | ✗ (no colour change) | ~ UA default | ✗ | n/a | n/a | n/a | n/a |
| wallet button, `nav.tsx:56` | ~ vendor `#1a1f2e` (measured) | ~ vendor `outline-color:#fff` | ✗ | ~ vendor `color:#999` | ~ vendor "Connecting…" | n/a | ~ vendor |
| home card link, `page.tsx:53` | ✓ `hover:border-white/20 hover:bg-white/[0.04]` | ~ `focus-visible:border-[#5e6ad2] focus-visible:outline-none` — 1px border colour is the entire indicator | ✗ | n/a | n/a | n/a | n/a |
| primary button, `explore:75`, `agent-chat:142`, `launch-form:209` | ✓ | ~ ✓ the first two, ✗ **`launch-form.tsx:209` has none** | ✗ none of the three | ~ `disabled:opacity-50` vs `disabled:opacity-40` — two conventions | ~ label text only ("Building…" `:211`), no `aria-busy`, no `cursor-progress` | n/a | ~ `launch-form.tsx:101` writes API `issues[]` into the log instead of marking the field |
| secondary button, `launch-form.tsx:189/201/217`, `error.tsx:30` | ✓ `hover:bg-white/5` | ✗ all four | ✗ | ~ two of four (`201`,`217`); `189` and `error.tsx:30` have none | ✗ | n/a | n/a |
| input, `launch-form.tsx:153`, `explore:70`, `agent-chat:137` | ✗ (no hover state at all) | ~ `focus:border-[#5e6ad2]` **with `outline-none`** (`:153`/`:70`/`:137`) — uses `focus:` (so mouse clicks paint it) and replaces the ring with a 1px border colour | ✗ | ✗ no `disabled:` styling anywhere | ✗ no `aria-busy` while the form is busy | n/a | ~ no `aria-invalid`, no per-field error, no `aria-describedby` |
| textarea, `launch-form.tsx:179` | ✗ | ~ same recipe | ✗ | ✗ | ✗ | n/a | ✗ (label promises "max 32 bytes" at `:162` and "max 13" at `:166`; neither field sets `maxLength`) |
| suggestion chips, `agent-chat.tsx:150-158` | ✓ `hover:border-white/25 hover:text-white` | ✗ | ✗ | ✓ `disabled:opacity-40` (`:155`) | n/a | n/a | n/a |
| chat turn list, `agent-chat.tsx:83-120` | n/a | n/a | n/a | n/a | ~ only the Send button says "thinking…" (`:144`); turns appear with no skeleton and **no `aria-live`** | ✓ good empty state (`:84-89`) | ✓ error banner (`:122-124`) |
| audit trail, `agent-chat.tsx:100-114` | ✗ (summary is `text-[11px] text-white/40`, `:101`, no hover) | ~ UA default on `<summary>` | ✗ | n/a | n/a | ~ renders nothing when `steps.length === 0` (`:99`) | ~ per-step ok/fail in colour + word (`:107-109`, correct) |
| build log, `launch-form.tsx:240-242` | n/a | n/a | ✗ (no clear/reset) | n/a | ✗ | ✓ "nothing yet" (`:241`) | ~ errors are strings in the log, indistinguishable from info lines; `say()` (`:39`) appends forever with no cap |
| explore result, `explore/page.tsx:87-146` | ~ chips only (`:133`) | ~ chips (UA default) | n/a | n/a | ✗ **no result skeleton; only the button label changes** (`:77`) | ✗ **no pre-lookup empty state** | ✓ red banner (`:81-85`), but not tied to the input |
| vault cards, `vault/page.tsx:44-58` | n/a | n/a | n/a | n/a | ✗ no skeleton (server-rendered; `await connection()` at `:21`) | ~ "not configured" is a value, not a state (`:27`) | ~ status text exists (`:64-68`, `:76-80`) — good |
| launched feed, `launched/page.tsx:49-104` | ✗ rows have no hover | ✗ chips use UA default | n/a | n/a | ✗ no skeleton while `lifecycleFeed()` resolves (`:17`) | ✓ amber "tracker returned nothing" (`:50-53`) — good; ✗ a *bucket* with 0 rows is silently skipped (`:57`), so "Graduating: 0" is indistinguishable from "the API dropped that bucket" | ~ covered by the amber banner |
| error boundary, `error.tsx` | ✓ button hover | ✗ button focus | ✗ | n/a | n/a | n/a | ✓ shows `error.message` + digest (`:23-26`); missing `role="alert"` and no focus move to the `<h1>` on mount |

**One positive to keep:** there are no keyboard traps. Every interactive element is a real `<a>`, `<button type="button">`, `<input>`, `<textarea>` or `<summary>`; tab order follows DOM order; the nav's scroll container (`nav.tsx:33`) does not swallow Tab.

---

## 5. The 10 highest-impact changes

Reference systems, all from `popular-web-designs`: **Linear** (`templates/linear.app.md`) is the base system this app is already imitating, so every token below is quoted from it — canvas `#08090a`, surfaces `rgba(255,255,255,0.02→0.04→0.05)`, borders `rgba(255,255,255,0.05→0.08)`, accent `#5e6ad2` / `#7170ff` / `#828fff`, text `#f7f8f8` / `#d0d6e0` / `#8a8f98` / `#62666d`, radius scale 2/4/6/8/12px, and "elevation via background luminance stepping, never shadow darkness". **Vercel** (`templates/vercel.md`) is used for the two structural moves (a featured card in a card grid; a 3-step pipeline). **Sentry** (`templates/sentry.md`) is used for the uppercase micro-label tracking in the launched feed.

---

### 5.1 → `src/app/globals.css` — make the palette real tokens and stop overriding the shell

Delete the create-next-app block at `:3-20` (`:root { --background: #ffffff; --foreground: #171717 }`, the `prefers-color-scheme` block) and the `body` rule at `:22-26`. Replace `@theme inline` (`:8-13`) and append:

```css
@theme inline {
  --color-canvas: #08090a;
  --color-surface: rgba(255, 255, 255, 0.02);
  --color-surface-raised: rgba(255, 255, 255, 0.04);
  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-accent: #5e6ad2;
  --color-accent-hover: #4f59b8;
  --color-accent-focus: #828fff;
  --color-text-primary: #f7f8f8;
  --color-text-secondary: #d0d6e0;
  --color-text-tertiary: #8a8f98;
  --color-text-quaternary: #62666d;
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@layer base {
  body {
    @apply bg-canvas text-text-primary font-sans antialiased;
  }
}
```

Then `bg-[#08090a]` → `bg-canvas`, `text-white/40` → `text-text-tertiary`, `border-white/10` → `border-hairline`, `bg-[#5e6ad2]` → `bg-accent`. This also puts the body rules *inside* `@layer base`, so a utility can win on `body` again — the bug in §1.1 cannot come back. **Design system: Linear §2 (Background Surfaces / Text & Content / Brand & Accent) and §7 "…never solid backgrounds on dark".**

### 5.2 → `src/app/layout.tsx:30` and `src/components/nav.tsx:25` — apply the Linear text ramp and an active-tab indicator

`layout.tsx:30` → `className="min-h-full flex flex-col bg-canvas font-sans text-text-primary antialiased"`.
`nav.tsx:25` → `className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-md"` (Linear borders are `rgba(255,255,255,0.05–0.08)`; the current `border-white/10` = 1.24:1 is a hairline before the fix and an invisible line after, so pin it at 0.08 explicitly).
`nav.tsx:46` (active tab) → `bg-white/[0.06] text-text-primary shadow-[inset_0_-1px_0_0_#7170ff]` and `nav.tsx:47` (inactive) → `text-text-secondary hover:bg-white/[0.04] hover:text-text-primary`; add `aria-current` styling as above (`:43` already sets `aria-current="page"` — good). Keep `#5e6ad2` for CTAs only. **Design system: Linear §4 Navigation ("Links 13–14px weight 510, `#d0d6e0`, hover/active lightens to `#f7f8f8`") and §9 ("Brand indigo is the only chromatic colour — reserve for CTA and interactive accents").**

### 5.3 → `src/components/nav.tsx:56` — bring the wallet button into the design system

```jsx
<div className="shrink-0 [&_.wallet-adapter-button]:!h-8 [&_.wallet-adapter-button]:!px-3 [&_.wallet-adapter-button]:!text-[13px] [&_.wallet-adapter-button]:!font-medium [&_.wallet-adapter-button]:!font-sans [&_.wallet-adapter-button]:!rounded-md [&_.wallet-adapter-button]:!border [&_.wallet-adapter-button]:!border-hairline [&_.wallet-adapter-button]:!bg-surface [&_.wallet-adapter-button]:hover:!bg-surface-raised [&_.wallet-adapter-button]:focus-visible:!outline-2 [&_.wallet-adapter-button]:focus-visible:!outline-offset-2 [&_.wallet-adapter-button]:focus-visible:!outline-accent-focus">
```

Measured basis: the vendor sheet ships `background-color:#512da8`, `height:48px`, `padding:0 24px`, `border-radius:4px`, `font-family: DM Sans, …`, hover `#1a1f2e`, focus `outline-color:#fff`. Today only height and font-size are overridden (`!h-9 !text-sm`), so the app's most prominent control is purple-when-it-should-be-accent and in a fourth typeface. **Design system: Linear §4 "Ghost Button — Background `rgba(255,255,255,0.02)`, text `#e2e4e7`, radius 6px, border `1px solid rgb(36,40,44)`".**

### 5.4 → `src/components/nav.tsx:33-54` — make the six tabs fit at 390px

```jsx
<nav aria-label="Dashboard sections"
     className="grid w-full grid-cols-3 gap-1 sm:flex sm:w-auto sm:flex-1 sm:items-center sm:overflow-x-auto sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
```

and the row (`:26`) → `className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3"`, tab padding (`:44`) → `px-2.5 py-1.5 text-sm sm:px-3`. At 390px that is a 3×2 grid inside the header (≈110px per tab, all six visible, no hidden scroll). **Design system: Linear §8 "Navigation: horizontal links + CTAs → collapsed at 768px"** — a 3×2 tab grid is the ≤`sm` collapse for a 6-tab app where a hamburger would cost a click for the five most-used destinations.

### 5.5 → new `src/components/ui/card.tsx` + `button.tsx` + `input.tsx` + `alert.tsx` — kill the 27 hand-copies (§2.6)

```jsx
// Card
"rounded-lg border border-hairline bg-surface"                                  // base — replaces 12 sites
"transition-colors hover:border-white/20 hover:bg-surface-raised focus-visible:border-accent focus-visible:outline-none"  // highlight — page.tsx:53
"rounded-md border border-hairline bg-surface p-3"                              // inset — replaces black/30 + black/40

// Button primary
"inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover active:bg-[#4750a5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus disabled:pointer-events-none disabled:opacity-50"

// Button secondary
"inline-flex items-center justify-center gap-2 rounded-md border border-white/15 bg-surface px-3 py-2 text-sm text-[#e2e4e7] transition-colors hover:bg-white/[0.06] active:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus disabled:pointer-events-none disabled:opacity-40"

// Input
"w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-text-secondary outline-none placeholder:text-text-quaternary focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus disabled:opacity-40 aria-invalid:border-red-500/40"
```

Replaces: `launch-form.tsx:153/189/201/209/217/240`, `explore/page.tsx:70/75/95/118/133/82`, `agent-chat.tsx:97/123/137/142/155`, `error.tsx:23/30`, `page.tsx:53`, `launch/page.tsx:23/35/41`, `agents/page.tsx:22`, `vault/page.tsx:46/62/74`, `launched/page.tsx:50/83`, `loading.tsx:8`. Substituting `bg-surface` for `bg-black/30`/`bg-black/40` also fixes the depth-direction flip in §2.4. **Design system: Linear §4 (Buttons: Primary Brand `#5e6ad2` radius 6px, Ghost `rgba(255,255,255,0.02)` + `1px solid rgba(255,255,255,0.08)`, Text Area `rgba(255,255,255,0.02)` / padding `12px 14px`) and §6 ("elevation via background luminance steps 0.02 → 0.04 → 0.05").**

### 5.6 → every `text-white/40`, `/35`, `/45`, `/30` — the contrast pass

Measured: `text-white/40` **3.76:1** (canvas) / 3.81 (card) — 12 sites; `text-white/35` **3.12:1** / 3.18 — 6 sites; `text-white/45` **4.49:1** / 4.52 — 4 sites; `placeholder:text-white/30` **2.58:1** — 3 sites.

| today | replace with | new ratio | sites |
|---|---|---|---|
| `text-white/40` | `text-text-tertiary` (`#8a8f98`) | **6.13:1** | `page.tsx:61`, `launch/page.tsx:54`, `launch/page.tsx:60`, `explore/page.tsx:102`, `explore/page.tsx:106`, `explore/page.tsx:119`, `agent-chat.tsx:94`, `agent-chat.tsx:101`, `vault/page.tsx:47`, `vault/page.tsx:88`, `settings/page.tsx:30`, `launched/page.tsx:59` |
| `text-white/35` | `text-text-tertiary` (`#8a8f98`) | **6.13:1** | `launch-form.tsx:223`, `explore/page.tsx:141`, `agent-chat.tsx:78`, `launched/page.tsx:35`, `launched/page.tsx:44`, `launched/page.tsx:76` |
| `text-white/45` | `text-text-tertiary` (`#8a8f98`) | 6.13:1 | `agent-chat.tsx:85`, `vault/page.tsx:69`, `vault/page.tsx:81`, `launched/page.tsx:74` |
| `text-white/55`, `text-white/50`, `text-white/60` | `text-text-secondary` (`#d0d6e0`) | **13.64:1** | `page.tsx:56`, `launch/page.tsx:25`, `vault/page.tsx:64-68` stays as status, `settings/page.tsx:26`, `agent-chat.tsx:155`, `launched/page.tsx:34`, and all page intros |
| `placeholder:text-white/30` | `placeholder:text-text-quaternary` (`#62666d`) | 3.45:1 (Linear's own placeholder token) | `launch-form.tsx:153`, `explore/page.tsx:70`, `agent-chat.tsx:137` |

Also cap the micro sizes: `text-[11px]` → `text-xs` (12px) at `launch-form.tsx:223/232`, `agent-chat.tsx:78/101`, `error.tsx:23`; and `text-[10px]` → `text-[11px]` at `launch/page.tsx:44` (or delete the badge once §5.7 makes the mode real). **Design system: Linear §2 text ramps.**

### 5.7 → `src/app/launch/page.tsx:32-58` + `launch-form.tsx:196-222` — make the mode a control and stop over-selling "Sign & send"

Mode cards (`:35`, `:41`) become real radio cards:

```jsx
<label className="relative flex cursor-pointer items-start gap-3 rounded-md border border-hairline bg-surface p-3 transition-colors hover:border-white/20 has-[:checked]:border-accent has-[:checked]:bg-[#5e6ad2]/[0.08] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-focus">
  <input type="radio" name="launch-mode" className="sr-only" defaultChecked />
```

Badge (`:44`) → `rounded border border-hairline bg-surface px-1.5 py-0.5 text-[11px] text-text-tertiary`.
Step 3 (`launch-form.tsx:213-221`) becomes accent **only when it can actually send**: keep `border-white/15 bg-surface` while `!sendEnabled`, add `aria-disabled={!sendEnabled}`, and promote the gating line (`:223-226`) to `text-xs text-amber-200` so the constraint is a first-class state, not a footnote. **Design system: Linear §4 "Deep Violet (Select/Dropdown) — `#422082` bg, 8px radius" (the local equivalent is `bg-[#5e6ad2]/[0.08]`) and §5 radius scale; Vercel §4 "Workflow Pipeline — three-step horizontal pipeline, each step with its own accent colour"** for the 1·2·3 row.

### 5.8 → `src/app/page.tsx:48-63` — give the home page one primary action and delete the roadmap

```jsx
<div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {/* featured */}
  <Link href="/launch" className="group flex items-start justify-between gap-4 rounded-lg border border-hairline bg-surface p-5 transition-colors hover:border-white/20 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus sm:col-span-2 lg:col-span-3">
    <div>
      <div className="text-base font-medium">Launch</div>
      <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-text-secondary">…</p>
    </div>
    <span className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors group-hover:bg-accent-hover">Open</span>
  </Link>
  {/* the other five exactly as today, with Card variants */}
</div>
```

Delete `page.tsx:61-63` entirely (the Phases line). Change `page.tsx:39-41` to `text-xl font-semibold tracking-tight` so all seven titles agree, and keep the `<p>` at `:42` at `text-sm text-text-secondary` (7.26:1 → 13.64:1). **Design system: Vercel §5 "Feature cards: 3-column → 2-column → single column" and §4 "Metric Cards — large number, description below"; the featured-then-grid pattern is Vercel's `Sub-heading Large` / `Card Title` split.**

### 5.9 → `src/app/explore/page.tsx` — hierarchy inside the result, a real empty state, and no overflow

- Mint paragraph (`:99-102`) → `className="mt-1 truncate font-mono text-xs text-text-tertiary"` (fixes the 390px overflow in §3.7) with `title={token.mint}` for the full value.
- Prices get scale: the first three stats (`:111-123`) → value class `mt-1 text-lg font-medium tabular-nums`, label `text-[11px] uppercase tracking-[0.2em] text-text-tertiary`; `DEX` stays `text-sm`. Give the grid `sm:grid-cols-4` (unchanged) but wrap price/market cap in `text-text-primary` and liquidity/DEX in `text-text-secondary`.
- Add the pre-lookup empty state: a `Card` with `border-dashed border-white/15 p-6 text-center` + `text-sm text-text-secondary` ("Paste a mint to look it up — nothing is sent to the chain.") and a loading skeleton mirroring the result card while `busy`.
- Placeholder (`:68`) → `placeholder="mint address"`; keep the example as text under the field.
- Label the input (§6.2): `<label htmlFor="explore-mint" className="text-xs font-medium text-text-tertiary">Token mint</label>`, add `id="explore-mint"`, `aria-describedby` → the error `<p>` at `:82`.
- **Design system: Sentry §3 "Micro Label 10px weight 600, `text-transform: uppercase`, letter-spacing 0.25px" for the tracked labels, and Linear §3 "Caption 13px / Label 12px" for the ramp.**

### 5.10 → `src/app/agents/agent-chat.tsx:83-160` + `src/app/launched/page.tsx:59-96` — density and live regions

- `agent-chat.tsx:83` → add `aria-live="polite" aria-busy={busy}` so an answer is announced; `:148` → `flex flex-col gap-2 sm:flex-row sm:flex-wrap` and chips (`:155`) → `w-full rounded border border-hairline px-2 py-1 text-left text-xs text-text-tertiary transition-colors hover:border-white/25 hover:text-text-primary disabled:opacity-40 sm:w-auto`.
- Add a copy-to-clipboard button on each audit trail (`:100-114`) — the whole premise of this component is auditability, and the trail is `text-[11px] text-white/40` (3.76:1 → `text-xs text-text-tertiary`).
- `launched/page.tsx:59` → `text-[11px] font-medium uppercase tracking-[0.2em] text-text-tertiary` (currently 3.76:1 at 12px, the only uppercase label in the app); `:64` row → `flex items-center gap-3 p-3 transition-colors hover:bg-surface`; `:76` mint → `truncate font-mono text-xs text-text-tertiary`; give each bucket a zero-count line instead of the silent skip at `:57`.
- **Design system: Sentry §4 "Uppercase Label — `text-transform: uppercase`, 0.2px letter-spacing, weight 500" and its data-dense dashboard density; Linear §4 "Mono Caption 13px weight 400 for code metadata".**

---

## 6. Actively broken for accessibility

1. **Light-mode inversion makes body copy invisible.** `globals.css:22-26` + `layout.tsx:30`, mechanics in §1.1. `text-white/60` over `#ffffff` = **1.00:1**. Affects every route's intro paragraph (`page.tsx:42`, `launch/page.tsx:12`, `explore/page.tsx:59`, `agents/page.tsx:11`, `vault/page.tsx:38`, `settings/page.tsx:18`, `launched/page.tsx:28`). This is the single most severe defect in the review. (WCAG 1.4.3.)
2. **Two inputs have no accessible name.** `explore/page.tsx:65-71` and `agent-chat.tsx:133-138` carry only a `placeholder` — no `<label>`, no `aria-label`. (WCAG 1.3.1 / 4.1.2; axe `label`.) `launch-form.tsx` gets this right (`:162-183` all have labels) — copy that pattern.
3. **The two unlabeled inputs are identified only by a 1.24:1 border.** `border-white/10` measures 1.24:1 against the canvas and 1.24:1 against the input fill; the placeholder is 2.58:1. With no label to identify the field, that is the only thing on screen saying "this is a text field" — below the 3:1 of 1.4.11 and the 4.5:1 of 1.4.3 (placeholder text). The three labeled inputs in `launch-form.tsx:162-183` are fine on this point, because the visible label identifies them.
4. **Contrast failures on 12px body text, measured:** `text-white/40` 3.76:1 (12 sites), `text-white/35` 3.12:1 (6 sites), `text-white/45` 4.49:1 (4 sites), `placeholder:text-white/30` 2.58:1 (3 sites). Full replacement table in §5.6. (WCAG 1.4.3.)
5. **Four places delete the focus ring, three different focus conventions app-wide.** `outline-none` on `launch-form.tsx:153`, `explore/page.tsx:70`, `agent-chat.tsx:137`, `page.tsx:53`. The inputs replace it with `focus:border-[#5e6ad2]` (4.04:1 against the input fill — that clears 3:1, but it is `focus:`, not `focus-visible:`, and it is a 1px border colour as the *only* indicator, which fails the 2px-perimeter of 2.4.13). The home cards replace it with a border change alone. Meanwhile `nav.tsx:44-48`, `launch-form.tsx:189/201/217`, `error.tsx:30` and `agent-chat.tsx:155` define no focus style at all and fall through to the UA ring. Standardise on one recipe: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus`. `#828fff` measures **6.95:1** on the canvas — but only **1.64:1** against `#5e6ad2`, so never drop `outline-offset-2` on an accent surface.
6. **No bypass block.** The six nav links plus the wallet button precede `<main>` (`layout.tsx:33`) and there is no skip link. (WCAG 2.4.1, AA.) Add `<a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-white">Skip to content</a>` and `<main id="main" tabIndex={-1}>`.
7. **No live regions on the two async surfaces.** The chat turn list (`agent-chat.tsx:83`) and the build log (`launch-form.tsx:240-242`) both update after a fetch with no `aria-live`/`role="status"` — screen-reader users get silence. Add `aria-live="polite"` to both.
8. **Labels promise limits the inputs do not enforce, and server errors never reach the field.** `launch-form.tsx:162` says "max 32 bytes" and `:166` "max 13" with no `maxLength` on `:163`/`:167`; the API's `issues[]` (`:11`) are stringified into the build log at `:101` instead of being shown per field with `aria-invalid`/`aria-describedby`. (WCAG 3.3.1 / 3.3.3.)
9. **`prefers-reduced-motion` is ignored.** `animate-pulse` (`loading.tsx:4`, `:5`, `:8`) and the smooth `scrollIntoView` (`agent-chat.tsx:64`) run regardless. Use `motion-safe:animate-pulse` and gate the scroll: `scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })`.

**Called out as fine, so nobody "fixes" them:**

- `nav.tsx:43` sets `aria-current="page"` correctly; `nav.tsx:28` marks the brand dot `aria-hidden`; `nav.tsx:34` labels the nav — the navigation is the most accessible part of the app.
- No keyboard traps; no non-semantic buttons anywhere (every control is a real `<button>`/`<a>`/`<input>`; nothing is a `div` with an `onClick`).
- `alt=""` on token art (`explore/page.tsx:95`, `launched/page.tsx:67`) is correct: the token name sits immediately beside the image, so the image is genuinely decorative.
- Status colours are always paired with a word ("passed"/"failed", "ok"/"fail", "decrypts"/"unavailable"), so 1.4.1 is met without icons.
- Long-address wrapping is right in `vault/page.tsx:48` and `launch-form.tsx:232` (`break-all`) — the bug in §3.7 is `explore/page.tsx:102` missing it, not the pattern being wrong.
- The `max-w-*` + `px-4` + `py-10` shell, the 3-step radius scale (`rounded` / `rounded-md` / `rounded-lg`), the `divide-y` list in `settings/page.tsx:22`, and the dashed empty state in `launched/page.tsx:33` are all sound. Do not redesign them; extract them (§2.6).

---

## Counts

| section | findings |
|---|---|
| 1. Hierarchy and layout | 10 |
| 2. Typography / spacing / colour / depth | 6 groups + 8-row extraction table (27 hand-written sites) |
| 3. Mobile at 390px | 18 |
| 4. States | 17 components, 41 gaps (hover 6, focus 9, pressed 12, disabled 7, loading 5, empty 2) |
| 5. Top-10 changes | 10 |
| 6. Accessibility | 9 failures, 6 explicit "fine" notes |

**Do first, in this order:** §5.1 (the cascade fix — without it the app is a white page with invisible card text in light mode), §5.2 (apply the Linear text/border ramp in the two shell files), §5.3 (the wallet button is the one control on every page that is entirely outside the design system, and the fix is one className).
