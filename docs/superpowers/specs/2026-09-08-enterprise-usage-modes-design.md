# Enterprise + all-plan usage modes — design

Date: 2026-09-08  
Status: Ready for implementation planning  
Repo: `cursor-headroom` (published as `rijojoy.cursor-usage-split`)

## One-line pitch

Keep the Auto / API / on-demand chip for personal plans, and switch the same status bar to a single `$used / $cap` meter when Cursor tracks the account as one dollar budget (Teams per-seat cap, Enterprise overall, Enterprise pooled).

## Problem

The extension assumes every signed-in account looks like personal Pro / Ultra:

```
Cursor 42% · Other 18% · On-d $4.20
```

That comes from `GetCurrentPeriodUsage.planUsage.autoPercentUsed` / `apiPercentUsed`. Enterprise and many Teams accounts do **not** expose that split as the headline. Cursor’s own dashboard shows one monthly (or contract) dollar cap, e.g. `$200 / $400`. On those accounts `planUsage` is often missing entirely, so the chip renders `Cursor — · Other — · On-d $—.——` even though usage is available.

Live shapes other tools have captured:

| Account | Headline in Cursor dashboard | Typical payload |
|---|---|---|
| Pro / Pro+ / Ultra | Auto % and API % | `planUsage.autoPercentUsed` + `apiPercentUsed` (Connect RPC) or `individualUsage.plan` (REST summary) |
| Teams | Auto/API % when present; on-demand $ as a separate pool | `spendLimitUsage.limitType = "team"` and/or `pooledLimit` |
| Enterprise, per-member monthly cap | `$used / $limit` for **this user** | `individualUsage.overall = { used, limit, remaining }` in cents |
| Enterprise, pooled usage | Shared pool, sometimes plus a personal cap | `teamUsage.pooled` and optionally `individualUsage.overall` |
| Unlimited enterprise | No cap | `isUnlimited: true` |

`GetCurrentPeriodUsage` is enough for personal plans. For several Enterprise/team contracts it returns billing-cycle dates and little else. The dashboard then loads `GET https://cursor.com/api/usage-summary`, which **does** carry `overall` / `pooled` / `membershipType`.

## Goals

- Zero extra setup. Same local Cursor login. No cookie paste, no PAT, no admin API key.
- Auto-detect the right headline. Never make the user pick “I am on Enterprise.”
- Personal Pro/Ultra stays visually unchanged.
- Enterprise / dollar-cap users see `$200.00 / $400.00` (used / cap), colored with the existing 60 / 85 bands.
- Missing numbers stay `null`. Never coerce a missing cap to `$0 / $0` or `0%`.
- Tooltip + details panel explain the same number Cursor’s Usage page shows, plus Auto/API percents when those fields exist as extras.

## Non-goals

- Admin views (org-wide spend tables, billing groups, member lists).
- Setting or changing spend caps.
- Microsoft Marketplace.
- Manual `displayMode` setting. Detection is the product. Revisit only if a live account is misclassified.
- Parsing display-message prose (`"You've used 42% of…"`) as a primary source. Numeric fields only. Prose is a last-resort documented fallback, not v1.
- Refreshing Cursor’s access token. If it is expired, keep the existing Auth / Sign in path.

## Account modes (detected from fields, not plan name)

Do **not** branch on `planName === "Enterprise"`. Names and `membershipType` strings drift. Classify from which numeric meters are present.

```
if isUnlimited:
  mode = unlimited
else if individualUsage.overall.limit > 0 (or equivalent cents pair):
  mode = budget          # personal monthly dollar cap — $200 / $400
else if autoPercentUsed or apiPercentUsed is a finite number:
  mode = split           # current personal chip
else if planUsage.limit > 0:
  mode = budget          # included spend vs plan limit, no split percents
else if spendLimitUsage.individualLimit > 0:
  mode = budget
else if teamUsage.pooled.limit > 0 or spendLimitUsage.pooledLimit > 0:
  mode = budget          # shared pool is the only meter
else:
  mode = split           # unknown; render em-dashes, never fake zeros
```

**Why overall beats Auto/API percents.** CodexBar and OpenUsage both saw Enterprise payloads that include a personal `overall` cap *and* a huge `teamUsage.pooled`. The number a member cares about — and the one that matches `$200 / $400` on the dashboard — is `overall`. Keep pooled as a secondary panel row when it is present and distinct.

**Why Auto/API percents beat a raw `planUsage.limit`.** Ultra still has `limit: 40000` cents *and* the split percents. Those users must stay on the current chip. Only fall through to dollars-from-`planUsage` when the split fields are absent.

## `UsageSnapshot` additions

Keep every existing field. Add:

```ts
type DisplayMode = "split" | "budget" | "unlimited";

type UsageSnapshot = {
  // existing fields unchanged…
  displayMode: DisplayMode;
  membershipType: string | null;     // "pro" | "ultra" | "enterprise" | "team" | …
  budgetUsedUsd: number | null;
  budgetLimitUsd: number | null;
  budgetPct: number | null;          // used/limit*100; null if no cap
  budgetLabel: "Usage" | "Your limit" | "Team pool" | null;
  teamPoolUsedUsd: number | null;
  teamPoolLimitUsd: number | null;
};
```

Cents from Cursor → USD `/ 100`. `overall.used` / `pooled.used` / `planUsage.totalSpend` / `spendLimitUsage.*` are cents on every captured payload.

`budgetLabel`:

- `"Your limit"` when the source is `individualUsage.overall` or `individualLimit`
- `"Team pool"` when the source is `teamUsage.pooled` / `pooledLimit` and there is no personal overall
- `"Usage"` when the source is `planUsage.totalSpend` / `planUsage.limit`

## UI

### Status bar

| Mode | Chip |
|---|---|
| `split` | unchanged: `Cursor 42% · Other 18% · On-d $4.20` |
| `budget` | `$(dashboard) $200.00 / $400.00` |
| `unlimited` | `$(dashboard) Unlimited` |
| loading / sign-in / auth | unchanged |

Stale suffix ` ·` still applies.

Color: existing green < 60, yellow 60–84, red ≥ 85.

- `split`: worst of Cursor %, Other %, on-demand % (on-demand ignored if uncapped) — current `statusBarBand`
- `budget`: `budgetPct` only
- `unlimited`: default foreground (no traffic-light)

Width: two-decimal `formatUsd` on both sides so `$ 12.30 / $400.00` does not jump when cents appear.

### Tooltip

**Budget** — one primary row: label, `$used / $limit`, fill bar from `budgetPct`. If Auto/API percents exist, two extra rows underneath (same as today, smaller). If `teamPool*` is present and is not the headline source, a muted “Team pool $x / $y” line. Footer: plan / membership, reset date.

**Split** — unchanged three rows.

**Unlimited** — “No usage cap on this plan.” + reset date if known.

### Details panel

**Budget** — one wide primary card (the dollar pair + bar). Optional second row of cards: Cursor %, Other %, On-demand, Team pool — omit a card when its value is `null`.

**Split** — current three-column grid.

**Unlimited** — single card, copy “Unlimited”, no bar.

Header still shows plan name + reset date. Prefer `GetPlanInfo.planName`; if missing, title-case `membershipType`.

## Data flow

Every tick:

1. Resolve token from `state.vscdb` (unchanged).
2. Parallel: `GetCurrentPeriodUsage`, `GetHardLimit`, `GetPlanInfo` (unchanged).
3. Map that trio. If the snapshot is already `split` with at least one percent, or `budget`/`unlimited` with a usable meter, stop.
4. **Fallback only when the Connect payload is unusable** (no finite Auto/API percent, no overall/pooled/plan limit, not unlimited): `GET https://cursor.com/api/usage-summary`.
5. Merge summary into the mapper (summary fills gaps; Connect fields win when present).
6. Push snapshot to status bar, tooltip, panel.

Personal Pro users keep three DashboardService calls and never hit `cursor.com`. Enterprise users typically add one GET.

### Auth for `usage-summary`

Still no third-party server. Additional host is `cursor.com` (same product as `api2.cursor.sh`).

Try in order:

1. `Authorization: Bearer <accessToken>` (same token we already send to `api2.cursor.sh`).
2. If 401/403: `Cookie: WorkosCursorSessionToken=<userId>%3A%3A<accessToken>` plus `Origin: https://cursor.com`.

`userId` resolution (first hit wins):

1. `ItemTable` key `cursorAuth/cachedUserId` (or `cursorAuth/userId` if that is what the DB has)
2. JWT `sub` on the access token: take the segment after the last `|` (`google-oauth2|user_abc` → `user_abc`)

Token still never logged. Log only `displayMode`, which source filled the budget (`overall` / `planLimit` / `individualLimit` / `pooled`), and HTTP status of the fallback.

If the fallback also fails, keep last-good snapshot + stale, same as today.

### Mapper merge

`mapUsage(period, hardLimit, planInfo, summary, fetchedAt, stale)`

`pickPlan` already accepts `period.planUsage` or `period.individualUsage.plan`. Extend picks:

- `overall` ← `period.individualUsage.overall` then `summary.individualUsage.overall`
- `pooled` ← `period.teamUsage.pooled` then `summary.teamUsage.pooled` then `spendLimitUsage.pooledUsed/pooledLimit`
- `membershipType` ← summary, else plan info, else `period.membershipType`
- `isUnlimited` ← `period.isUnlimited` or `summary.isUnlimited`

On-demand mapping stays as today (individual used, then pooled used, then derived from total − included). For budget mode, on-demand is **not** the headline unless it is the only numeric cap.

## Error handling

Existing table unchanged for token / 401 / 429 / 5xx.

New rows:

| Situation | Status bar | Detail |
|---|---|---|
| Connect payload empty, summary succeeds | Budget or split from summary | Normal |
| Connect empty, summary 401 | Last good + ` ·`, or Auth if never succeeded | Diagnose auth |
| `isUnlimited` | `Unlimited` | Tooltip explains no cap |
| Budget used present, limit missing | `$200.00 / —` , bar green (`noCap`) | “no spend limit” |
| Overall + pooled both present | Headline = overall | Panel shows team pool as secondary |

## Testing

Automated, no live login:

- Existing Pro split fixture still produces `displayMode: "split"` and the current chip string.
- Ultra with `planUsage.limit` **and** Auto/API percents stays `split`.
- Enterprise `individualUsage.overall` `{ used: 20000, limit: 40000 }` → budget `$200.00 / $400.00`, `budgetPct === 50`.
- Enterprise overall + pooled: headline is overall; `teamPool*` populated.
- Pooled-only: headline is team pool.
- `isUnlimited: true` → `unlimited`, chip `Unlimited`.
- Empty Connect + filled summary → same as if summary were the period body.
- Missing fields never become `0`.
- `statusBarBand` on budget uses `budgetPct`; unlimited is not red.
- Cookie / user-id helpers: JWT `sub` parse, `%3A%3A` cookie format. No network.

Manual (Extension Development Host):

- Personal account: chip unchanged vs 0.1.3.
- Enterprise / Teams dollar-cap account: chip matches Settings → Usage (`$x / $y`).
- Sign-out, offline, 10s tick: existing checks.

## README / listing

- Pitch line mentions both personal split **and** enterprise dollar caps.
- “What you see” shows both chip examples.
- How it works: add `cursor.com/api/usage-summary` as an enterprise fallback; still no third-party server.
- Keywords: add `enterprise`, `teams`.

## Privacy

Token is sent to `api2.cursor.sh` (always) and `cursor.com` (only on the unusable-Connect fallback). Never written to our storage. Never logged.
