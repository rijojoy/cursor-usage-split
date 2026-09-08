# Enterprise usage modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect personal split-percent vs enterprise/team dollar-cap accounts and render `$used / $cap` for the latter without changing the Pro/Ultra chip.

**Architecture:** Keep `mapUsage` as the only JSON → `UsageSnapshot` function. Classify `displayMode` from numeric fields (never from plan name). Fetch `GET cursor.com/api/usage-summary` only when `GetCurrentPeriodUsage` has no usable meter. Status bar / tooltip / panel branch on `displayMode`.

**Tech Stack:** TypeScript 5, VS Code engine ^1.85.0, Node `fetch`, vitest. No new dependencies.

## Global Constraints

- Zero setup; token from `state.vscdb` only; never logged
- Extra host allowed: `cursor.com` (usage-summary fallback only). No third-party servers
- Never coerce missing percents or missing caps to `0`
- Personal Pro/Ultra with Auto/API percents must keep `displayMode: "split"` even when `planUsage.limit` is set
- `individualUsage.overall` wins over `teamUsage.pooled` for the headline
- Color bands: green < 60, yellow 60–84, red ≥ 85 (`#3fb950` / `#d29922` / `#f85149`)
- Refresh default **10000** ms, minimum **10000**
- Settings prefix stays `cursorUsageSplit.*`
- Spec: `docs/superpowers/specs/2026-09-08-enterprise-usage-modes-design.md`

## File map

- Modify: `src/usage.ts` — snapshot fields, classification, merge of Connect + summary
- Modify: `src/usage.test.ts` — fixtures for every account shape
- Modify: `src/format.ts` / `src/format.test.ts` — budget + unlimited chips
- Modify: `src/colors.ts` / `src/colors.test.ts` — band from `budgetPct`
- Modify: `src/auth.ts` / `src/auth.test.ts` — user id + session cookie helpers
- Modify: `src/api.ts` — `fetchUsageSummary`
- Create: `src/api.test.ts` — cookie header / fallback gate (pure helpers if extracted)
- Modify: `src/tooltip.ts` — budget / unlimited hover
- Modify: `src/panel.ts` — budget / unlimited layout
- Modify: `src/extension.ts` — conditional summary fetch
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (0.2.0)

---

### Task 1: Snapshot type + classification helpers

**Files:**
- Modify: `src/usage.ts`
- Test: `src/usage.test.ts`

**Interfaces:**
- Consumes: existing `toNumber`, `asRecord` patterns in `src/usage.ts`
- Produces: `DisplayMode`, `BudgetLabel`, extended `UsageSnapshot`, `centsPairToUsd`, `classifyDisplayMode`, `needsUsageSummaryFallback`

- [ ] **Step 1: Write the failing tests for classification**

Add to `src/usage.test.ts` (keep existing `mapUsage` tests; they will be updated in Task 2):

```ts
import {
  classifyDisplayMode,
  needsUsageSummaryFallback,
  centsPairToUsd,
} from "./usage";

describe("centsPairToUsd", () => {
  it("converts Cursor cents to dollars", () => {
    expect(centsPairToUsd(20000, 40000)).toEqual({
      usedUsd: 200,
      limitUsd: 400,
      pct: 50,
    });
  });

  it("returns nulls when limit is missing or not positive", () => {
    expect(centsPairToUsd(20000, null)).toEqual({
      usedUsd: 200,
      limitUsd: null,
      pct: null,
    });
    expect(centsPairToUsd(20000, 0)).toEqual({
      usedUsd: 200,
      limitUsd: null,
      pct: null,
    });
  });
});

describe("classifyDisplayMode", () => {
  it("is unlimited when the flag is set", () => {
    expect(
      classifyDisplayMode({
        isUnlimited: true,
        overallLimitCents: 40000,
        autoPercentUsed: 10,
        apiPercentUsed: 10,
        planLimitCents: 40000,
        individualLimitCents: null,
        pooledLimitCents: 1_000_000,
      }),
    ).toEqual({ mode: "unlimited", budgetSource: null });
  });

  it("prefers personal overall cap over pooled and over Auto/API percents", () => {
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: 40000,
        autoPercentUsed: 12,
        apiPercentUsed: 8,
        planLimitCents: 40000,
        individualLimitCents: null,
        pooledLimitCents: 2_812_2000,
      }),
    ).toEqual({ mode: "budget", budgetSource: "overall" });
  });

  it("stays split for Ultra when percents exist and overall is absent", () => {
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: null,
        autoPercentUsed: 42,
        apiPercentUsed: 18,
        planLimitCents: 40000,
        individualLimitCents: null,
        pooledLimitCents: null,
      }),
    ).toEqual({ mode: "split", budgetSource: null });
  });

  it("uses plan limit as budget when percents are missing", () => {
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: null,
        autoPercentUsed: null,
        apiPercentUsed: null,
        planLimitCents: 40000,
        individualLimitCents: null,
        pooledLimitCents: null,
      }),
    ).toEqual({ mode: "budget", budgetSource: "plan" });
  });

  it("uses individual spend limit, then pooled, then split-with-gaps", () => {
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: null,
        autoPercentUsed: null,
        apiPercentUsed: null,
        planLimitCents: null,
        individualLimitCents: 10000,
        pooledLimitCents: 50000,
      }),
    ).toEqual({ mode: "budget", budgetSource: "individual" });
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: null,
        autoPercentUsed: null,
        apiPercentUsed: null,
        planLimitCents: null,
        individualLimitCents: null,
        pooledLimitCents: 50000,
      }),
    ).toEqual({ mode: "budget", budgetSource: "pooled" });
    expect(
      classifyDisplayMode({
        isUnlimited: false,
        overallLimitCents: null,
        autoPercentUsed: null,
        apiPercentUsed: null,
        planLimitCents: null,
        individualLimitCents: null,
        pooledLimitCents: null,
      }),
    ).toEqual({ mode: "split", budgetSource: null });
  });
});

describe("needsUsageSummaryFallback", () => {
  it("is true only when split mode has no percents and no budget dollars", () => {
    expect(
      needsUsageSummaryFallback({
        displayMode: "split",
        cursorPct: null,
        otherPct: null,
        budgetUsedUsd: null,
        budgetLimitUsd: null,
      }),
    ).toBe(true);
    expect(
      needsUsageSummaryFallback({
        displayMode: "split",
        cursorPct: 42,
        otherPct: null,
        budgetUsedUsd: null,
        budgetLimitUsd: null,
      }),
    ).toBe(false);
    expect(
      needsUsageSummaryFallback({
        displayMode: "budget",
        cursorPct: null,
        otherPct: null,
        budgetUsedUsd: 200,
        budgetLimitUsd: 400,
      }),
    ).toBe(false);
    expect(
      needsUsageSummaryFallback({
        displayMode: "unlimited",
        cursorPct: null,
        otherPct: null,
        budgetUsedUsd: null,
        budgetLimitUsd: null,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/usage.test.ts`

Expected: FAIL with `Failed to import` / `classifyDisplayMode is not exported`.

- [ ] **Step 3: Implement helpers + extend the snapshot type**

In `src/usage.ts`, replace the `UsageSnapshot` type and add the helpers **above** `mapUsage`. Leave `mapUsage` returning the old shape for this commit if needed — Task 2 wires it. Preferred: extend the type now and give `mapUsage` the new fields with split-mode defaults so existing tests still compile.

```ts
export type DisplayMode = "split" | "budget" | "unlimited";
export type BudgetLabel = "Usage" | "Your limit" | "Team pool";
export type BudgetSource = "overall" | "plan" | "individual" | "pooled";

export type UsageSnapshot = {
  displayMode: DisplayMode;
  cursorPct: number | null;
  otherPct: number | null;
  onDemandUsd: number | null;
  onDemandPct: number | null;
  onDemandEnabled: boolean;
  budgetUsedUsd: number | null;
  budgetLimitUsd: number | null;
  budgetPct: number | null;
  budgetLabel: BudgetLabel | null;
  budgetSource: BudgetSource | null;
  teamPoolUsedUsd: number | null;
  teamPoolLimitUsd: number | null;
  planName: string | null;
  membershipType: string | null;
  includedUsd: number | null;
  cycleStart: string | null;
  cycleEnd: string | null;
  fetchedAt: number;
  stale: boolean;
};

export type ClassifyInput = {
  isUnlimited: boolean;
  overallLimitCents: number | null;
  autoPercentUsed: number | null;
  apiPercentUsed: number | null;
  planLimitCents: number | null;
  individualLimitCents: number | null;
  pooledLimitCents: number | null;
};

export function centsPairToUsd(
  usedCents: number | null,
  limitCents: number | null,
): { usedUsd: number | null; limitUsd: number | null; pct: number | null } {
  const usedUsd = usedCents === null ? null : usedCents / 100;
  const limitUsd =
    limitCents !== null && limitCents > 0 ? limitCents / 100 : null;
  const pct =
    usedUsd !== null && limitUsd !== null && limitUsd > 0
      ? (usedUsd / limitUsd) * 100
      : null;
  return { usedUsd, limitUsd, pct };
}

export function classifyDisplayMode(
  input: ClassifyInput,
): { mode: DisplayMode; budgetSource: BudgetSource | null } {
  if (input.isUnlimited) {
    return { mode: "unlimited", budgetSource: null };
  }
  if (input.overallLimitCents !== null && input.overallLimitCents > 0) {
    return { mode: "budget", budgetSource: "overall" };
  }
  if (input.autoPercentUsed !== null || input.apiPercentUsed !== null) {
    return { mode: "split", budgetSource: null };
  }
  if (input.planLimitCents !== null && input.planLimitCents > 0) {
    return { mode: "budget", budgetSource: "plan" };
  }
  if (input.individualLimitCents !== null && input.individualLimitCents > 0) {
    return { mode: "budget", budgetSource: "individual" };
  }
  if (input.pooledLimitCents !== null && input.pooledLimitCents > 0) {
    return { mode: "budget", budgetSource: "pooled" };
  }
  return { mode: "split", budgetSource: null };
}

export function needsUsageSummaryFallback(
  snap: Pick<
    UsageSnapshot,
    "displayMode" | "cursorPct" | "otherPct" | "budgetUsedUsd" | "budgetLimitUsd"
  >,
): boolean {
  if (snap.displayMode === "unlimited" || snap.displayMode === "budget") {
    return false;
  }
  return (
    snap.cursorPct === null &&
    snap.otherPct === null &&
    snap.budgetUsedUsd === null &&
    snap.budgetLimitUsd === null
  );
}

function budgetLabelFor(source: BudgetSource | null): BudgetLabel | null {
  if (source === "overall" || source === "individual") {
    return "Your limit";
  }
  if (source === "pooled") {
    return "Team pool";
  }
  if (source === "plan") {
    return "Usage";
  }
  return null;
}
```

Temporarily, at the end of the current `mapUsage` return, add the new fields so TypeScript compiles:

```ts
    displayMode: "split",
    membershipType: null,
    budgetUsedUsd: null,
    budgetLimitUsd: null,
    budgetPct: null,
    budgetLabel: null,
    budgetSource: null,
    teamPoolUsedUsd: null,
    teamPoolLimitUsd: null,
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run src/usage.test.ts`

Expected: PASS for the new describes. Existing `mapUsage` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/usage.ts src/usage.test.ts
git commit -m "$(cat <<'EOF'
feat: classify split vs dollar-budget usage modes

Detect personal Auto/API split vs enterprise overall/pooled caps from numeric fields so the mapper can pick a headline without branching on plan name.
EOF
)"
```

---

### Task 2: Map Connect + usage-summary payloads into one snapshot

**Files:**
- Modify: `src/usage.ts` (`mapUsage`)
- Modify: `src/usage.test.ts`

**Interfaces:**
- Consumes: `classifyDisplayMode`, `centsPairToUsd`, `budgetLabelFor` from Task 1
- Produces: `mapUsage(period, hardLimit, planInfo, fetchedAt, stale?, summary?)` filling every `UsageSnapshot` field

- [ ] **Step 1: Write failing mapper fixtures**

Append to `src/usage.test.ts`. First update the existing Pro test to assert `displayMode === "split"` and `budgetUsedUsd === null`.

Then add:

```ts
  it("maps enterprise overall cents to a $200 / $400 budget", () => {
    const snap = mapUsage(
      {
        billingCycleStart: "2026-09-01T00:00:00.000Z",
        billingCycleEnd: "2026-10-01T00:00:00.000Z",
        membershipType: "enterprise",
        individualUsage: {
          overall: { enabled: true, used: 20000, limit: 40000, remaining: 20000 },
        },
        teamUsage: {
          onDemand: { enabled: true, used: 0, limit: null, remaining: null },
          pooled: { enabled: true, used: 1_272_5135, limit: 2_812_2000, remaining: 1_539_6865 },
        },
      },
      { noUsageBasedAllowed: false },
      { planInfo: { planName: "Enterprise" } },
      fetchedAt,
    );

    expect(snap.displayMode).toBe("budget");
    expect(snap.budgetSource).toBe("overall");
    expect(snap.budgetLabel).toBe("Your limit");
    expect(snap.budgetUsedUsd).toBe(200);
    expect(snap.budgetLimitUsd).toBe(400);
    expect(snap.budgetPct).toBe(50);
    expect(snap.teamPoolUsedUsd).toBeCloseTo(127251.35);
    expect(snap.teamPoolLimitUsd).toBe(281220);
    expect(snap.cursorPct).toBeNull();
    expect(snap.otherPct).toBeNull();
    expect(snap.planName).toBe("Enterprise");
    expect(snap.membershipType).toBe("enterprise");
  });

  it("does not switch Ultra to budget just because planUsage.limit exists", () => {
    const snap = mapUsage(
      {
        planUsage: {
          autoPercentUsed: 98.1,
          apiPercentUsed: 100,
          totalPercentUsed: 98.5,
          includedSpend: 40000,
          totalSpend: 40000,
          limit: 40000,
        },
      },
      {},
      { planInfo: { planName: "Ultra" } },
      fetchedAt,
    );
    expect(snap.displayMode).toBe("split");
    expect(snap.cursorPct).toBe(98.1);
    expect(snap.otherPct).toBe(100);
    expect(snap.budgetUsedUsd).toBeNull();
  });

  it("fills gaps from usage-summary when Connect period is empty", () => {
    const summary = {
      membershipType: "enterprise",
      billingCycleStart: "2026-09-01T00:00:00.000Z",
      billingCycleEnd: "2026-10-01T00:00:00.000Z",
      individualUsage: {
        overall: { enabled: true, used: 20000, limit: 40000, remaining: 20000 },
      },
    };
    const snap = mapUsage({}, {}, {}, fetchedAt, false, summary);
    expect(snap.displayMode).toBe("budget");
    expect(snap.budgetUsedUsd).toBe(200);
    expect(snap.budgetLimitUsd).toBe(400);
    expect(snap.cycleEnd).toBe("2026-10-01T00:00:00.000Z");
  });

  it("lets Connect overall win over summary pooled-only data", () => {
    const snap = mapUsage(
      {
        individualUsage: {
          overall: { enabled: true, used: 5000, limit: 10000, remaining: 5000 },
        },
      },
      {},
      {},
      fetchedAt,
      false,
      {
        teamUsage: {
          pooled: { enabled: true, used: 100, limit: 999999, remaining: 999899 },
        },
      },
    );
    expect(snap.budgetSource).toBe("overall");
    expect(snap.budgetUsedUsd).toBe(50);
    expect(snap.budgetLimitUsd).toBe(100);
  });

  it("maps pooled-only enterprise to a team-pool budget", () => {
    const snap = mapUsage(
      {
        teamUsage: {
          pooled: { enabled: true, used: 10000, limit: 40000, remaining: 30000 },
        },
      },
      {},
      {},
      fetchedAt,
    );
    expect(snap.displayMode).toBe("budget");
    expect(snap.budgetSource).toBe("pooled");
    expect(snap.budgetLabel).toBe("Team pool");
    expect(snap.budgetUsedUsd).toBe(100);
    expect(snap.budgetLimitUsd).toBe(400);
  });

  it("maps unlimited enterprise without faking a cap", () => {
    const snap = mapUsage({ isUnlimited: true }, {}, {}, fetchedAt, false, {
      isUnlimited: true,
      membershipType: "enterprise",
    });
    expect(snap.displayMode).toBe("unlimited");
    expect(snap.budgetUsedUsd).toBeNull();
    expect(snap.budgetLimitUsd).toBeNull();
    expect(snap.membershipType).toBe("enterprise");
  });

  it("maps plan-limit budget when percents are absent", () => {
    const snap = mapUsage(
      { planUsage: { totalSpend: 20000, includedSpend: 20000, limit: 40000 } },
      {},
      {},
      fetchedAt,
    );
    expect(snap.displayMode).toBe("budget");
    expect(snap.budgetSource).toBe("plan");
    expect(snap.budgetUsedUsd).toBe(200);
    expect(snap.budgetLimitUsd).toBe(400);
    expect(snap.includedUsd).toBe(200);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/usage.test.ts -t "enterprise overall"`

Expected: FAIL (`displayMode` is `"split"` or `budgetUsedUsd` is null).

- [ ] **Step 3: Implement mapping**

Change `mapUsage` signature to:

```ts
export function mapUsage(
  period: unknown,
  hardLimit: unknown,
  planInfo: unknown,
  fetchedAt: number,
  stale = false,
  summary: unknown = null,
): UsageSnapshot
```

Add picks (reuse `asRecord` / `toNumber`):

```ts
function pickOverall(period: Record<string, unknown> | null, summary: Record<string, unknown> | null) {
  return (
    asRecord(asRecord(period?.individualUsage)?.overall) ??
    asRecord(asRecord(summary?.individualUsage)?.overall)
  );
}

function pickPooled(period: Record<string, unknown> | null, summary: Record<string, unknown> | null, spend: Record<string, unknown> | null) {
  return (
    asRecord(asRecord(period?.teamUsage)?.pooled) ??
    asRecord(asRecord(summary?.teamUsage)?.pooled) ??
    (spend && (toNumber(spend.pooledLimit) !== null || toNumber(spend.pooledUsed) !== null)
      ? { used: spend.pooledUsed, limit: spend.pooledLimit }
      : null)
  );
}
```

Inside `mapUsage`, after existing plan/spend/hard/info picks, also:

```ts
  const summaryRec = asRecord(summary);
  const overall = pickOverall(periodRec, summaryRec);
  const pooled = pickPooled(periodRec, summaryRec, spend);

  const autoPercentUsed =
    toNumber(plan?.autoPercentUsed) ??
    toNumber(asRecord(asRecord(summaryRec?.individualUsage)?.plan)?.autoPercentUsed);
  const apiPercentUsed =
    toNumber(plan?.apiPercentUsed) ??
    toNumber(asRecord(asRecord(summaryRec?.individualUsage)?.plan)?.apiPercentUsed);

  const overallUsed = toNumber(overall?.used);
  const overallLimit = toNumber(overall?.limit);
  const pooledUsed = toNumber(pooled?.used);
  const pooledLimit = toNumber(pooled?.limit);
  const planLimit = toNumber(plan?.limit);
  const planSpend = toNumber(plan?.totalSpend) ?? toNumber(plan?.includedSpend);
  const individualLimit =
    toNumber(spend?.individualLimit) ??
    toNumber(asRecord(asRecord(periodRec?.individualUsage)?.onDemand)?.limit) ??
    toNumber(asRecord(asRecord(summaryRec?.individualUsage)?.onDemand)?.limit);
  const individualUsed =
    toNumber(spend?.individualUsed) ??
    toNumber(asRecord(asRecord(periodRec?.individualUsage)?.onDemand)?.used) ??
    toNumber(asRecord(asRecord(summaryRec?.individualUsage)?.onDemand)?.used);

  const isUnlimited = periodRec?.isUnlimited === true || summaryRec?.isUnlimited === true;

  const classified = classifyDisplayMode({
    isUnlimited,
    overallLimitCents: overallLimit,
    autoPercentUsed,
    apiPercentUsed,
    planLimitCents: planLimit,
    individualLimitCents: individualLimit,
    pooledLimitCents: pooledLimit,
  });

  let budgetUsedUsd: number | null = null;
  let budgetLimitUsd: number | null = null;
  let budgetPct: number | null = null;
  if (classified.budgetSource === "overall") {
    ({ usedUsd: budgetUsedUsd, limitUsd: budgetLimitUsd, pct: budgetPct } = centsPairToUsd(overallUsed, overallLimit));
  } else if (classified.budgetSource === "plan") {
    ({ usedUsd: budgetUsedUsd, limitUsd: budgetLimitUsd, pct: budgetPct } = centsPairToUsd(planSpend, planLimit));
  } else if (classified.budgetSource === "individual") {
    ({ usedUsd: budgetUsedUsd, limitUsd: budgetLimitUsd, pct: budgetPct } = centsPairToUsd(individualUsed, individualLimit));
  } else if (classified.budgetSource === "pooled") {
    ({ usedUsd: budgetUsedUsd, limitUsd: budgetLimitUsd, pct: budgetPct } = centsPairToUsd(pooledUsed, pooledLimit));
  }

  const teamPool = centsPairToUsd(pooledUsed, pooledLimit);

  const membershipType =
    (typeof periodRec?.membershipType === "string" && periodRec.membershipType) ||
    (typeof summaryRec?.membershipType === "string" && summaryRec.membershipType) ||
    null;
```

Keep the existing on-demand block. Cycle dates: `periodRec ?? summaryRec`. Plan name: existing, else title-case `membershipType` only in the panel later — mapper stores raw `membershipType`.

Return the full snapshot including `cursorPct: autoPercentUsed`, `otherPct: apiPercentUsed`, `displayMode: classified.mode`, `budgetLabel: budgetLabelFor(classified.budgetSource)`, `budgetSource: classified.budgetSource`, `teamPoolUsedUsd` / `teamPoolLimitUsd` from `teamPool` (null when both missing).

When `displayMode === "unlimited"`, force budget fields to null.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/usage.test.ts`

Expected: PASS. If the original Pro on-demand test still expects `onDemandPct` null with no cap, leave that behavior.

- [ ] **Step 5: Commit**

```bash
git add src/usage.ts src/usage.test.ts
git commit -m "$(cat <<'EOF'
feat: map enterprise overall and pooled dollar caps

Merge GetCurrentPeriodUsage with usage-summary so a personal $used/$limit headline wins over the org pool, and empty Connect payloads can still produce a snapshot.
EOF
)"
```

---

### Task 3: Status-bar strings and color bands

**Files:**
- Modify: `src/format.ts`
- Modify: `src/format.test.ts`
- Modify: `src/colors.ts`
- Modify: `src/colors.test.ts`

**Interfaces:**
- Consumes: `UsageSnapshot.displayMode`, `budgetUsedUsd`, `budgetLimitUsd`, `budgetPct`
- Produces: `formatStatusBar` chips for budget/unlimited; `statusBarBand` reads budget mode

- [ ] **Step 1: Write failing format + color tests**

In `src/format.test.ts`, keep the existing three-way split test (add `displayMode: "split"` to the Pick object). Add:

```ts
  it("renders a dollar-cap chip", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "budget",
        cursorPct: null,
        otherPct: null,
        onDemandUsd: null,
        budgetUsedUsd: 200,
        budgetLimitUsd: 400,
        stale: false,
      }),
    ).toBe("$(dashboard) $200.00 / $400.00");
  });

  it("renders unlimited", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "unlimited",
        cursorPct: null,
        otherPct: null,
        onDemandUsd: null,
        budgetUsedUsd: null,
        budgetLimitUsd: null,
        stale: false,
      }),
    ).toBe("$(dashboard) Unlimited");
  });

  it("appends stale on the budget chip", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "budget",
        cursorPct: null,
        otherPct: null,
        onDemandUsd: null,
        budgetUsedUsd: 12.3,
        budgetLimitUsd: 400,
        stale: true,
      }),
    ).toBe("$(dashboard) $12.30 / $400.00 ·");
  });

  it("shows an em dash when the budget limit is missing", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "budget",
        cursorPct: null,
        otherPct: null,
        onDemandUsd: null,
        budgetUsedUsd: 200,
        budgetLimitUsd: null,
        stale: false,
      }),
    ).toBe("$(dashboard) $200.00 / $—.——");
  });
```

In `src/colors.test.ts`:

```ts
  it("uses budgetPct as the only band in budget mode", () => {
    expect(
      statusBarBand(
        {
          displayMode: "budget",
          cursorPct: 99,
          otherPct: 99,
          onDemandPct: null,
          budgetPct: 50,
        },
        60,
        85,
      ),
    ).toBe("green");
    expect(
      statusBarBand({
        displayMode: "budget",
        cursorPct: null,
        otherPct: null,
        onDemandPct: null,
        budgetPct: 90,
      }),
    ).toBe("red");
  });

  it("does not traffic-light unlimited", () => {
    expect(
      statusBarBand({
        displayMode: "unlimited",
        cursorPct: 100,
        otherPct: 100,
        onDemandPct: 100,
        budgetPct: null,
      }),
    ).toBe("green");
  });
```

Update existing `statusBarBand` calls to include `displayMode: "split"` and `budgetPct: null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/format.test.ts src/colors.test.ts`

Expected: FAIL (unknown `displayMode` property / chip still the three-way string).

- [ ] **Step 3: Implement**

`src/format.ts`:

```ts
export function formatStatusBar(
  kind: StatusKind,
  snapshot?: Pick<
    UsageSnapshot,
    | "displayMode"
    | "cursorPct"
    | "otherPct"
    | "onDemandUsd"
    | "budgetUsedUsd"
    | "budgetLimitUsd"
    | "stale"
  >,
): string {
  if (kind === "loading") {
    return "$(dashboard) Cursor · Other · On-d …";
  }
  if (kind === "sign-in") {
    return "$(dashboard) Usage Split: Sign in";
  }
  if (kind === "auth") {
    return "$(dashboard) Usage Split: Auth";
  }
  if (!snapshot) {
    return "$(dashboard) Cursor · Other · On-d …";
  }
  const stale = snapshot.stale ? " ·" : "";
  if (snapshot.displayMode === "unlimited") {
    return `$(dashboard) Unlimited${stale}`;
  }
  if (snapshot.displayMode === "budget") {
    return `$(dashboard) ${formatUsd(snapshot.budgetUsedUsd)} / ${formatUsd(snapshot.budgetLimitUsd)}${stale}`;
  }
  return `$(dashboard) Cursor ${formatPercent(snapshot.cursorPct)} · Other ${formatPercent(snapshot.otherPct)} · On-d ${formatUsd(snapshot.onDemandUsd)}${stale}`;
}
```

`src/colors.ts` — extend `statusBarBand`:

```ts
export function statusBarBand(
  snap: {
    displayMode?: DisplayMode;
    cursorPct: number | null;
    otherPct: number | null;
    onDemandPct: number | null;
    budgetPct?: number | null;
  },
  warningPercent = 60,
  criticalPercent = 85,
): Band {
  if (snap.displayMode === "unlimited") {
    return "green";
  }
  if (snap.displayMode === "budget") {
    return colorBand(snap.budgetPct ?? null, warningPercent, criticalPercent, {
      noCap: snap.budgetPct == null,
    });
  }
  const bands: Band[] = [
    colorBand(snap.cursorPct, warningPercent, criticalPercent),
    colorBand(snap.otherPct, warningPercent, criticalPercent),
    colorBand(snap.onDemandPct, warningPercent, criticalPercent, {
      noCap: snap.onDemandPct === null,
    }),
  ];
  return bands.reduce((worst, band) => (RANK[band] > RANK[worst] ? band : worst), "green" as Band);
}
```

Import `DisplayMode` from `./usage`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/format.test.ts src/colors.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts src/colors.ts src/colors.test.ts
git commit -m "$(cat <<'EOF'
feat: render dollar-cap and unlimited status chips

Enterprise accounts get a $used / $limit chip colored by that cap; unlimited plans stay quiet green instead of inheriting leftover split percents.
EOF
)"
```

---

### Task 4: Session cookie + user id helpers

**Files:**
- Modify: `src/auth.ts`
- Modify: `src/auth.test.ts`

**Interfaces:**
- Consumes: existing `parseStoredAccessToken`
- Produces: `userIdFromJwt(token)`, `buildWorkosCookie(userId, token)`, `readItemTableString(bytes, key, wasmPath?)` (or extend the sqlite reader to fetch extra keys)

- [ ] **Step 1: Write failing tests**

```ts
import { userIdFromJwt, buildWorkosCookie } from "./auth";

describe("userIdFromJwt", () => {
  it("takes the segment after the last pipe in sub", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "google-oauth2|user_abc" }),
    ).toString("base64url");
    const token = `hdr.${payload}.sig`;
    expect(userIdFromJwt(token)).toBe("user_abc");
  });

  it("returns the whole sub when there is no pipe", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_abc" })).toString(
      "base64url",
    );
    expect(userIdFromJwt(`hdr.${payload}.sig`)).toBe("user_abc");
  });

  it("returns null for garbage", () => {
    expect(userIdFromJwt("not-a-jwt")).toBeNull();
  });
});

describe("buildWorkosCookie", () => {
  it("url-encodes userId::token", () => {
    expect(buildWorkosCookie("user_abc", "tok.en")).toBe(
      "WorkosCursorSessionToken=user_abc%3A%3Atok.en",
    );
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/auth.test.ts`

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement**

```ts
export function userIdFromJwt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { sub?: unknown };
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    const pipe = payload.sub.lastIndexOf("|");
    return pipe >= 0 ? payload.sub.slice(pipe + 1) : payload.sub;
  } catch {
    return null;
  }
}

export function buildWorkosCookie(userId: string, token: string): string {
  return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`;
}
```

Optional: in `readAccessTokenFromBytes`, also query `cursorAuth/cachedUserId` / `cursorAuth/userId` and export `getAuthContext()` returning `{ token, userId }`. If that is more than ~30 lines, keep JWT-only for v1 and resolve userId as `userIdFromJwt(token)` in `api.ts`. Prefer JWT-only unless a test account’s JWT has no `sub`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/auth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "$(cat <<'EOF'
feat: derive Cursor usage-summary session cookie

Build the WorkosCursorSessionToken header from the JWT subject so enterprise REST fallback can use the same login already on disk.
EOF
)"
```

---

### Task 5: usage-summary client

**Files:**
- Modify: `src/api.ts`
- Create: `src/api.test.ts` if you extract `shouldTrySummary` — otherwise test only via `needsUsageSummaryFallback` (already in Task 1) and keep `fetchUsageSummary` thin

**Interfaces:**
- Consumes: `userIdFromJwt`, `buildWorkosCookie`
- Produces: `fetchUsageSummary(token): Promise<unknown>`

- [ ] **Step 1: Write a unit test for the request helper if you extract it**

Extract `usageSummaryRequestInit(token: string, useCookie: boolean): RequestInit` so it can be tested without network:

```ts
import { describe, expect, it } from "vitest";
import { usageSummaryRequestInit } from "./api";

describe("usageSummaryRequestInit", () => {
  it("sends Bearer on the first attempt", () => {
    const init = usageSummaryRequestInit("abc.def.ghi", false);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer abc.def.ghi",
    });
  });

  it("sends the WorkOS cookie on the retry", () => {
    const init = usageSummaryRequestInit("hdr.eyJzdWIiOiJ1c2VyX2FiYyJ9.sig", true);
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain("WorkosCursorSessionToken=");
    expect(headers.Origin).toBe("https://cursor.com");
    expect(headers.Authorization).toBeUndefined();
  });
});
```

Use a real JWT payload `{"sub":"user_abc"}` base64url-encoded so `userIdFromJwt` works. Generate it in the test the same way as Task 4.

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/api.test.ts`

Expected: FAIL missing export.

- [ ] **Step 3: Implement `fetchUsageSummary`**

```ts
const WEB_ORIGIN = "https://cursor.com";

export function usageSummaryRequestInit(token: string, useCookie: boolean): RequestInit {
  if (!useCookie) {
    return {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    };
  }
  const userId = userIdFromJwt(token);
  if (!userId) {
    throw new AuthError("Cannot build Cursor session cookie");
  }
  return {
    method: "GET",
    headers: {
      Cookie: buildWorkosCookie(userId, token),
      Origin: WEB_ORIGIN,
      Accept: "application/json",
    },
  };
}

export async function fetchUsageSummary(token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (const useCookie of [false, true]) {
      const response = await fetch(`${WEB_ORIGIN}/api/usage-summary`, {
        ...usageSummaryRequestInit(token, useCookie),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        if (!useCookie) {
          continue;
        }
        throw new AuthError();
      }
      if (response.status === 429) {
        throw new RateLimitError();
      }
      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    }
    throw new AuthError();
  } catch (error) {
    if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(error instanceof Error ? error.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}
```

Import `userIdFromJwt` and `buildWorkosCookie` from `./auth`. Do **not** change `fetchUsagePayloads` here — the tick wires the fallback in Task 7.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/api.test.ts src/auth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/api.test.ts
git commit -m "$(cat <<'EOF'
feat: fetch cursor.com usage-summary as enterprise fallback

Try Bearer first, then the WorkOS session cookie, so empty GetCurrentPeriodUsage payloads can still yield overall/pooled caps.
EOF
)"
```

---

### Task 6: Tooltip and details panel

**Files:**
- Modify: `src/tooltip.ts`
- Modify: `src/panel.ts`
- Create: `src/tooltip.test.ts` only if you extract a pure markdown builder; otherwise rely on snapshot-driven string contains via a small exported `tooltipMarkdown(snapshot, warning, critical): string` that `buildTooltip` wraps

**Interfaces:**
- Consumes: full `UsageSnapshot` from Task 2
- Produces: hover + webview that match `displayMode`

- [ ] **Step 1: Extract pure tooltip body + tests**

Export `tooltipBodyHtml` (or markdown lines) from `src/tooltip.ts` and test without vscode if `MarkdownString` is awkward. Simplest path: export `tooltipLines(snapshot, warning, critical): string[]` and have `buildTooltip` join them.

```ts
import { describe, expect, it } from "vitest";
import { tooltipLines } from "./tooltip";

const base = {
  displayMode: "budget" as const,
  cursorPct: null,
  otherPct: null,
  onDemandUsd: null,
  onDemandPct: null,
  onDemandEnabled: true,
  budgetUsedUsd: 200,
  budgetLimitUsd: 400,
  budgetPct: 50,
  budgetLabel: "Your limit" as const,
  budgetSource: "overall" as const,
  teamPoolUsedUsd: 127251.35,
  teamPoolLimitUsd: 281220,
  planName: "Enterprise",
  membershipType: "enterprise",
  includedUsd: null,
  cycleStart: null,
  cycleEnd: "2026-10-01T00:00:00.000Z",
  fetchedAt: 1,
  stale: false,
};

describe("tooltipLines", () => {
  it("leads with the dollar cap for budget mode", () => {
    const text = tooltipLines(base, 60, 85).join("\n");
    expect(text).toContain("Your limit");
    expect(text).toContain("$200.00 / $400.00");
    expect(text).toContain("Team pool");
    expect(text).not.toContain("Cursor 42%");
  });

  it("keeps the three-row split tooltip", () => {
    const text = tooltipLines(
      { ...base, displayMode: "split", cursorPct: 42, otherPct: 18, onDemandUsd: 4.2, budgetUsedUsd: null, budgetLimitUsd: null, budgetPct: null, budgetLabel: null, budgetSource: null, teamPoolUsedUsd: null, teamPoolLimitUsd: null, planName: "Pro" },
      60,
      85,
    ).join("\n");
    expect(text).toContain("Cursor");
    expect(text).toContain("Other");
    expect(text).toContain("On-demand");
  });
});
```

For the panel, export a `panelCards(snapshot, warning, critical)` helper **or** assert via `renderPanelHtml` with a fake webview:

```ts
const webview = { cspSource: "vscode-webview:" } as vscode.Webview;
```

If vscode types are unavailable in vitest, don’t import vscode in the helper. `renderPanelHtml` already takes `webview.cspSource` — pass `{ cspSource: "x" } as vscode.Webview`. Existing panel isn’t unit-tested; add `src/panel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderPanelHtml } from "./panel";
import type { UsageSnapshot } from "./usage";

const webview = { cspSource: "csp" } as import("vscode").Webview;

it("renders the dollar pair as the primary card in budget mode", () => {
  const html = renderPanelHtml(webview, budgetSnapshot, 60, 85);
  expect(html).toContain("$200.00 / $400.00");
  expect(html).toContain("Your limit");
});

it("renders three split cards for Pro", () => {
  const html = renderPanelHtml(webview, proSnapshot, 60, 85);
  expect(html).toContain("On-demand");
  expect(html).toContain("Cursor");
});
```

Use the same `budgetSnapshot` / `proSnapshot` objects as above (full `UsageSnapshot`).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/tooltip.test.ts src/panel.test.ts`

Expected: FAIL (exports missing or HTML still the three-column grid only).

- [ ] **Step 3: Implement tooltip + panel**

Tooltip budget branch (before the current three-row body):

```ts
  if (snapshot.displayMode === "unlimited") {
    md.appendMarkdown(`**Unlimited** — no usage cap on this plan.\n`);
    md.appendMarkdown(`\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`);
    return md;
  }

  if (snapshot.displayMode === "budget") {
    const band = colorBand(snapshot.budgetPct, warningPercent, criticalPercent, {
      noCap: snapshot.budgetPct === null,
    });
    const label = snapshot.budgetLabel ?? "Usage";
    md.appendMarkdown(
      `**${label}** &nbsp; <span style="color:${BAND_HEX[band]};">${formatUsd(snapshot.budgetUsedUsd)} / ${formatUsd(snapshot.budgetLimitUsd)}</span>\n`,
    );
    md.appendMarkdown(bar(snapshot.budgetPct, BAND_HEX[band]));
    if (snapshot.cursorPct !== null) {
      // existing Cursor row
    }
    if (snapshot.otherPct !== null) {
      // existing Other row
    }
    if (
      snapshot.teamPoolUsedUsd !== null &&
      snapshot.teamPoolLimitUsd !== null &&
      snapshot.budgetSource !== "pooled"
    ) {
      md.appendMarkdown(
        `<span style="opacity:0.7;">Team pool ${formatUsd(snapshot.teamPoolUsedUsd)} / ${formatUsd(snapshot.teamPoolLimitUsd)}</span>\n`,
      );
    }
    md.appendMarkdown(`\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`);
    return md;
  }
  // existing split body
```

Panel: if `displayMode === "budget"`, set `.grid` to one column for the primary card, then a second `.grid` of optional cards (Cursor / Other / On-demand / Team pool) only when values exist. Primary value string: `` `${formatUsd(used)} / ${formatUsd(limit)}` ``. Sub: `${Math.round(budgetPct)}% of cap` or `no spend limit`. Unlimited: one card, value `Unlimited`, empty track.

Keep nonce / CSP / refresh button as they are.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/tooltip.test.ts src/panel.test.ts src/format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tooltip.ts src/panel.ts src/tooltip.test.ts src/panel.test.ts
git commit -m "$(cat <<'EOF'
feat: show dollar-cap tooltip and panel for enterprise

Match the dashboard $used / $limit headline in the hover and details tab, and keep Auto/API rows only when those percents exist.
EOF
)"
```

---

### Task 7: Wire the fallback into the poll loop + docs

**Files:**
- Modify: `src/extension.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json` (`version` → `0.2.0`, keywords `enterprise`, `teams`)

**Interfaces:**
- Consumes: `fetchUsagePayloads`, `fetchUsageSummary`, `mapUsage`, `needsUsageSummaryFallback`
- Produces: 10s tick that adds at most one extra GET for unusable Connect payloads

- [ ] **Step 1: Update `tick` in `src/extension.ts`**

Replace the fetch/map block:

```ts
    const payloads = await fetchUsagePayloads(token);
    let snapshot = mapUsage(
      payloads.period,
      payloads.hardLimit,
      payloads.planInfo,
      Date.now(),
      false,
    );
    if (needsUsageSummaryFallback(snapshot)) {
      try {
        const summary = await fetchUsageSummary(token);
        snapshot = mapUsage(
          payloads.period,
          payloads.hardLimit,
          payloads.planInfo,
          Date.now(),
          false,
          summary,
        );
        logInfo(
          `usage-summary fallback displayMode=${snapshot.displayMode} source=${snapshot.budgetSource ?? "none"}`,
        );
      } catch (error) {
        if (error instanceof AuthError) {
          throw error;
        }
        logError(
          error instanceof Error ? `usage-summary: ${error.message}` : "usage-summary failed",
        );
      }
    }
```

Log on every successful refresh (no token): `displayMode=… source=…`.

`applyBar("ok", snapshot)` already uses `formatStatusBar` / `statusBarBand` / `buildTooltip` — no further change if those accept the new fields.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`

Expected: PASS. There is no extension-host test; do not add a live login test.

- [ ] **Step 3: README + changelog**

README “What you see”:

```
Personal (Pro / Ultra):   Cursor 42% · Other 18% · On-d $4.20
Enterprise / dollar cap:  $200.00 / $400.00
```

How it works: mention `GetCurrentPeriodUsage` first, then `cursor.com/api/usage-summary` only when that payload has no usable meter. Still no third-party server.

CHANGELOG:

```
## 0.2.0

- Enterprise and Teams dollar caps in the status bar (`$used / $limit`)
- Personal Auto / API split unchanged
- Falls back to Cursor usage-summary when the dashboard RPC has no split percents
```

`package.json` version `0.2.0`. Add keywords `enterprise`, `teams`. Description: `Auto vs API usage, or enterprise dollar caps, in the Cursor status bar.`

- [ ] **Step 4: Compile**

Run: `npm test && npm run compile`

Expected: tests pass, `tsc` exits 0.

- [ ] **Step 5: Manual check (implementer)**

In Extension Development Host:

1. Personal account: chip matches 0.1.3.
2. Enterprise / Teams dollar-cap account: chip matches Settings → Usage `$x / $y` (not `Cursor —`).
3. Output channel line includes `displayMode=budget` (or `split`) and never the token.
4. Sign-out still shows Sign in.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts README.md CHANGELOG.md package.json
git commit -m "$(cat <<'EOF'
feat: poll usage-summary when Connect usage is empty

Enterprise accounts with a monthly dollar cap now get a live $used / $limit chip; Pro/Ultra still poll only the dashboard RPC.
EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Field-based `split` / `budget` / `unlimited` | 1, 2 |
| Overall beats pooled; percents beat raw `planUsage.limit` | 1, 2 |
| `$used / $limit` chip + 60/85 colors | 3 |
| Tooltip + panel | 6 |
| usage-summary fallback, Bearer then cookie | 4, 5, 7 |
| Personal chip unchanged | 2, 3, 7 |
| Never fake zeros | 1, 2 |
| README / 0.2.0 | 7 |

**Type names used everywhere:** `DisplayMode`, `BudgetLabel`, `BudgetSource`, `budgetUsedUsd`, `budgetLimitUsd`, `budgetPct`, `needsUsageSummaryFallback`, `fetchUsageSummary`, `usageSummaryRequestInit`.
