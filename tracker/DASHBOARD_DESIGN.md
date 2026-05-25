# CASPER DASHBOARD — DESIGN REFERENCE
> Reference: tracker/references/dashboard-ref-1.mp4, dashboard-ref-2.mp4 + 3 screenshots in session
> Do NOT redesign without reading this. Updated: 2026-04-11

---

## REFERENCE DESIGN BREAKDOWN

### Layout Grid
```
┌─────────────────────────────────────────────────────────┐
│ TOPBAR: team avatars | filters | timeframe toggle       │
├─────────────────────────────────────────────────────────┤
│ HERO: "New report" heading                              │
│ Revenue $528,976.82  ↑7.9%  +$27,335                   │
│ vs prev $501,641  · Jun 1–Aug 31                        │
│ ────────── member revenue share bar ──────────          │
│                                                         │
│ [Top sales] [Best deal ★ dark] [Deals] [Value] [Win%]  │
├──────────────────────┬──────────────────────────────────┤
│ LEFT PANEL           │ RIGHT PANEL                      │
│                      │                                  │
│ Platform list        │ Sales table                      │
│  Dribbble  43% ████  │  Avatar | Name | Rev | Leads     │
│  Instagram 27% ███   │  KPI | W/L pills | tags          │
│  Behance   11% █     │                                  │
│  Google     7% ▌     │ ──────────────────────────────── │
│                      │ Work with platforms               │
│ [Donut chart]        │  45.3%  $71,048                  │
│  by referrer         │  [Dribbble][Instagram][Google]   │
├──────────────────────┤  [Other]                         │
│ Platform value card  │ ──────────────────────────────── │
│ Dark bg, avg monthly │ Sales dynamic (line chart)        │
│ Rev/Leads/Win bar    │  W1  W3  W5  W7  W9  W11        │
│ chart (monthly)      │  pink line + gray line           │
└──────────────────────┴──────────────────────────────────┘
```

---

## DESIGN TOKENS (from reference — align with Casper vars)

| Element | Reference | Casper var |
|---------|-----------|------------|
| Outer bg | Warm gray | `--bg: #ECEAE4` ✅ same |
| Card bg | Pure white | `--surface: #FFFFFF` ✅ |
| Accent | Red-pink | `--accent: #E8365D` ✅ same |
| Black btn | Near black | `--black-btn: #1A1917` ✅ same |
| Card radius | ~16px | `--radius: 12px` (close) |
| Shadow | Soft, 2-layer | `--shadow` ✅ |
| Number font | Mono/tabular | `--font-mono` ✅ |
| Pill numbers | Dark circle, white text | build new `.pill` |
| Gold highlight | Warm gold | `--gold: #C9A96E` ✅ |

---

## CASPER MAPPING (reference → what it means for us)

| Reference element | Casper equivalent |
|-------------------|-------------------|
| Revenue $528,976 | Total Bank Settlement (sum of all SKU BS) |
| vs prev period | BS vs previous month |
| Top sales (person) | Best performing platform (highest total BS) |
| Best deal (dark card) | Best SKU — highest BS |
| Deals count | Total active SKUs |
| Value (highlighted) | Total profit ₹ |
| Win rate % | % of SKUs above breakeven |
| Platform list + % bars | Meesho/Flipkart/Amazon/Snapdeal/Myntra BS split |
| Donut chart | Platform BS % pie |
| Sales table (per person) | Per-SKU performance: BS, margin%, platform |
| Leads pill numbers | Orders / quantity |
| KPI decimal | Profit margin ratio |
| W/L pills | Win = above breakeven, Lose = below |
| Tags (Top sales 💪) | SKU badges: Best margin, Top platform, etc. |
| Work with platforms | Platform BS breakdown with % + ₹ |
| Sales dynamic chart | BS trend by week/month per platform |
| Platform value card | Per-platform deep stats (avg BS, SKU count) |

---

## COMPONENT BREAKDOWN

### 1. Hero Metric (Revenue → Total BS)
```
Label: "BANK SETTLEMENT"
Big number: ₹5,28,976.82  (integer large, decimal small)
Badge: ↑ 7.9%  (green if up, red if down)
Sub badge: +₹27,335
Compare: vs prev. ₹5,01,641 · [period]
```

### 2. Metric Cards Row (5 cards)
```
[Top Platform]  [Best SKU ★]  [Active SKUs]  [Total Profit]  [Win Rate]
  Meesho           SHJ-JS-VRI    47 SKUs      ₹1,28,400      84%
  ₹2,27,459         ₹4,200       ↑5            ↑7.9%         ↑1.2%
```
- Best SKU card = dark/black bg, white text, star icon
- Total Profit card = accent color border/highlight

### 3. Platform List (left panel)
```
🔴 Meesho     ₹2,27,459   43%  [████████████░░░░░░░░]
📦 Flipkart   ₹1,42,823   27%  [████████░░░░░░░░░░░░]
🟠 Amazon      ₹89,935    11%  [███░░░░░░░░░░░░░░░░░]
🔵 Snapdeal    ₹37,028     7%  [██░░░░░░░░░░░░░░░░░░]
```
- Platform icon (emoji or colored dot initially)
- Name + ₹ amount + % + horizontal bar

### 4. Platform Donut Chart
- % breakdown by platform
- Color per platform
- Center: total ₹ or dominant platform %

### 5. SKU Performance Table (right panel, replaces "sales table")
```
[Avatar] SKU        BS ₹      Qty   Margin  Profit/Loss
         SHJ-JS-VRI ₹2,09,633 [41] [118]  0.84  31% [12] 29
         SHJ-NK-VIC ₹1,56,841 [54] [103]  0.89  39% [21] 33
         tags: [Best margin 💰] [Top platform 🏆] [At risk ⚠️]
```

### 6. Platform BS Breakdown (right panel bottom-left)
```
45.3%  ₹71,048
[Meesho  28.1% ₹44,072]  [Flipkart 14.1% ₹22,114]
[Amazon   5.4%  ₹8,469]  [Other     7.1% ₹11,135]
```

### 7. BS Trend Chart (right panel bottom-right)
```
Line chart — weekly/monthly
Primary line: Total BS (accent color)
Secondary lines: per platform (muted colors)
X-axis: W1, W3, W5... or Jan, Feb, Mar...
Dots/avatars on peaks (best SKU that week)
```

### 8. Platform Value Card (left panel bottom)
Dark accent bg card:
```
Platform value: Meesho ▾
Avg monthly BS:  ₹18,652
SKU count:       37 / 276
Win / Lose:      16%  51/318
[bar chart — monthly]
```

---

## BUILD PRIORITY ORDER

1. **Hero + metric cards** — high visual impact, data already available from `/entries/`
2. **Platform BS breakdown** (45.3% style) — simple calculation from existing data
3. **Platform list with % bars** — straightforward
4. **SKU table** — most complex, needs sorting/filtering
5. **Donut chart** — needs recharts (already installed)
6. **BS trend chart** — needs time-series data (may need backend work)
7. **Platform value card** — needs per-platform aggregation

---

## DATA SOURCES (what backend calls we need)

| Widget | Endpoint | Status |
|--------|----------|--------|
| Total BS, SKU count, profit | `GET /entries/` (aggregate on FE) | ✅ exists |
| Platform BS split | `GET /entries/` (group by platform) | ✅ calculate on FE |
| BS trend over time | None yet | ❌ needs new endpoint |
| Per-SKU performance table | `GET /entries/` | ✅ exists |
| Previous period comparison | None yet | ❌ needs new endpoint |

**Start with FE-only aggregation from `/entries/` — no new backend needed for MVP.**

---

## OPEN DECISIONS (log here when agreed)

| # | Question | Decision | Date |
|---|----------|----------|------|
| D1 | Timeframe filter — static periods or date picker? | — | — |
| D2 | SKU table — paginated or scroll? | — | — |
| D3 | Charts lib — recharts (already installed) or other? | — | — |
| D4 | Platform icons — emoji, colored dots, or real logos? | — | — |
| D5 | Previous period comparison — compute on FE or new endpoint? | — | — |
