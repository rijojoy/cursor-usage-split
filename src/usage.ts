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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  const n = toNumber(value);
  if (n === null) {
    return null;
  }
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function centsToUsd(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

function pickPlan(period: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!period) {
    return null;
  }
  return asRecord(period.planUsage) ?? asRecord(asRecord(period.individualUsage)?.plan);
}

function pickSpendLimit(period: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!period) {
    return null;
  }
  return (
    asRecord(period.spendLimitUsage) ??
    asRecord(asRecord(period.individualUsage)?.onDemand) ??
    asRecord(asRecord(period.teamUsage)?.onDemand)
  );
}

function pickPlanInfo(planInfo: unknown): Record<string, unknown> | null {
  const root = asRecord(planInfo);
  if (!root) {
    return null;
  }
  return asRecord(root.planInfo) ?? root;
}

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

export function mapUsage(
  period: unknown,
  hardLimit: unknown,
  planInfo: unknown,
  fetchedAt: number,
  stale = false,
): UsageSnapshot {
  const periodRec = asRecord(period);
  const plan = pickPlan(periodRec);
  const spend = pickSpendLimit(periodRec);
  const hard = asRecord(hardLimit);
  const info = pickPlanInfo(planInfo);

  const onDemandEnabled = hard?.noUsageBasedAllowed !== true;

  let onDemandUsd: number | null = null;
  let onDemandPct: number | null = null;

  if (!onDemandEnabled) {
    onDemandUsd = 0;
  } else {
    const usedCents =
      toNumber(spend?.individualUsed) ??
      toNumber(spend?.pooledUsed) ??
      toNumber(spend?.used);
    if (usedCents !== null) {
      onDemandUsd = centsToUsd(usedCents);
    } else {
      const total = toNumber(plan?.totalSpend);
      const included = toNumber(plan?.includedSpend);
      const bonus = toNumber(plan?.bonusSpend) ?? 0;
      if (total !== null && included !== null) {
        onDemandUsd = centsToUsd(Math.max(0, total - included - bonus));
      }
    }

    const limitCents =
      toNumber(spend?.pooledLimit) ??
      toNumber(spend?.individualLimit) ??
      toNumber(spend?.limit) ??
      toNumber(hard?.hardLimit);
    if (
      onDemandUsd !== null &&
      limitCents !== null &&
      limitCents > 0
    ) {
      onDemandPct = (onDemandUsd / (limitCents / 100)) * 100;
    }
  }

  const includedCents =
    toNumber(plan?.includedSpend) ?? toNumber(info?.includedAmountCents);

  return {
    displayMode: "split",
    cursorPct: toNumber(plan?.autoPercentUsed),
    otherPct: toNumber(plan?.apiPercentUsed),
    onDemandUsd,
    onDemandPct,
    onDemandEnabled,
    membershipType: null,
    budgetUsedUsd: null,
    budgetLimitUsd: null,
    budgetPct: null,
    budgetLabel: null,
    budgetSource: null,
    teamPoolUsedUsd: null,
    teamPoolLimitUsd: null,
    planName:
      (typeof info?.planName === "string" && info.planName) ||
      (typeof info?.name === "string" && info.name) ||
      null,
    includedUsd: centsToUsd(includedCents),
    cycleStart: toIso(periodRec?.billingCycleStart ?? info?.billingCycleStart),
    cycleEnd: toIso(periodRec?.billingCycleEnd ?? info?.billingCycleEnd),
    fetchedAt,
    stale,
  };
}
