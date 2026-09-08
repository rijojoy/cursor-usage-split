import { describe, expect, it } from "vitest";
import {
  classifyDisplayMode,
  centsPairToUsd,
  mapUsage,
  needsUsageSummaryFallback,
} from "./usage";

const fetchedAt = 1_700_000_000_000;

describe("mapUsage", () => {
  it("maps a Pro Auto/API split from planUsage", () => {
    const snap = mapUsage(
      {
        billingCycleStart: "2026-08-01T00:00:00.000Z",
        billingCycleEnd: "2026-09-01T00:00:00.000Z",
        planUsage: {
          autoPercentUsed: 42.2,
          apiPercentUsed: 18.4,
          includedSpend: 8400,
          totalSpend: 8820,
          bonusSpend: 0,
          limit: 20000,
        },
      },
      { noUsageBasedAllowed: false },
      { planInfo: { planName: "Pro", includedAmountCents: 20000 } },
      fetchedAt,
    );

    expect(snap.cursorPct).toBe(42.2);
    expect(snap.otherPct).toBe(18.4);
    expect(snap.planName).toBe("Pro");
    expect(snap.includedUsd).toBe(84);
    expect(snap.onDemandUsd).toBeCloseTo(4.2);
    expect(snap.onDemandPct).toBeNull();
    expect(snap.onDemandEnabled).toBe(true);
    expect(snap.stale).toBe(false);
  });

  it("maps on-demand with a spend cap from spendLimitUsage", () => {
    const snap = mapUsage(
      {
        planUsage: { autoPercentUsed: 10, apiPercentUsed: 5, includedSpend: 1000, totalSpend: 1000 },
        spendLimitUsage: { individualUsed: 1250, pooledLimit: 5000 },
      },
      { noUsageBasedAllowed: false },
      {},
      fetchedAt,
    );

    expect(snap.onDemandUsd).toBe(12.5);
    expect(snap.onDemandPct).toBeCloseTo(25);
  });

  it("keeps on-demand percent null when there is no cap", () => {
    const snap = mapUsage(
      {
        planUsage: { autoPercentUsed: 10, apiPercentUsed: 5 },
        spendLimitUsage: { individualUsed: 400 },
      },
      { noUsageBasedAllowed: false },
      {},
      fetchedAt,
    );

    expect(snap.onDemandUsd).toBe(4);
    expect(snap.onDemandPct).toBeNull();
  });

  it("does not coerce missing percents to zero", () => {
    const snap = mapUsage({}, {}, {}, fetchedAt);
    expect(snap.cursorPct).toBeNull();
    expect(snap.otherPct).toBeNull();
    expect(snap.onDemandUsd).toBeNull();
  });

  it("preserves percents over 100", () => {
    const snap = mapUsage(
      { planUsage: { autoPercentUsed: 112, apiPercentUsed: 101 } },
      {},
      {},
      fetchedAt,
    );
    expect(snap.cursorPct).toBe(112);
    expect(snap.otherPct).toBe(101);
  });

  it("sets on-demand to $0.00 when usage-based billing is disabled", () => {
    const snap = mapUsage(
      {
        planUsage: { autoPercentUsed: 10, apiPercentUsed: 10, totalSpend: 5000, includedSpend: 1000 },
        spendLimitUsage: { individualUsed: 9999 },
      },
      { noUsageBasedAllowed: true },
      {},
      fetchedAt,
    );
    expect(snap.onDemandEnabled).toBe(false);
    expect(snap.onDemandUsd).toBe(0);
    expect(snap.onDemandPct).toBeNull();
  });
});

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
