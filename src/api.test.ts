import { afterEach, describe, expect, it, vi } from "vitest";
import { tryUsageSummary, usageSummaryRequestInit } from "./api";
import type { UsageSnapshot } from "./usage";

const fetchedAt = 1_700_000_000_000;

function emptySplitSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    displayMode: "split",
    cursorPct: null,
    otherPct: null,
    onDemandUsd: null,
    onDemandPct: null,
    onDemandEnabled: true,
    budgetUsedUsd: null,
    budgetLimitUsd: null,
    budgetPct: null,
    budgetLabel: null,
    budgetSource: null,
    teamPoolUsedUsd: null,
    teamPoolLimitUsd: null,
    planName: null,
    membershipType: null,
    includedUsd: null,
    cycleStart: null,
    cycleEnd: null,
    fetchedAt,
    stale: false,
    ...overrides,
  };
}

describe("usageSummaryRequestInit", () => {
  it("sends Bearer on the first attempt", () => {
    const init = usageSummaryRequestInit("abc.def.ghi", false);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer abc.def.ghi",
    });
  });

  it("sends the WorkOS cookie on the retry", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_abc" })).toString(
      "base64url",
    );
    const token = `hdr.${payload}.sig`;
    const init = usageSummaryRequestInit(token, true);
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain("WorkosCursorSessionToken=");
    expect(headers.Origin).toBe("https://cursor.com");
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("tryUsageSummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not fetch when fallback is not needed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = emptySplitSnapshot({ cursorPct: 42 });

    const result = await tryUsageSummary("token", snapshot, fetchedAt, {}, {}, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ snapshot, failed: false });
  });

  it("keeps the Connect snapshot when usage-summary returns 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = emptySplitSnapshot();

    const result = await tryUsageSummary("token", snapshot, fetchedAt, {}, {}, {});

    expect(fetchMock).toHaveBeenCalled();
    expect(result.failed).toBe(true);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.snapshot.displayMode).toBe("split");
    expect(result.snapshot.cursorPct).toBeNull();
  });

  it("keeps the Connect snapshot when usage-summary returns 403", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockResolvedValueOnce({ status: 403, ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = emptySplitSnapshot();

    const result = await tryUsageSummary("token", snapshot, fetchedAt, {}, {}, {});

    expect(result.failed).toBe(true);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.snapshot.displayMode).toBe("split");
  });

  it("remaps to budget when usage-summary returns overall cents", async () => {
    const summary = {
      membershipType: "enterprise",
      billingCycleEnd: "2026-10-01T00:00:00.000Z",
      individualUsage: {
        overall: { enabled: true, used: 20000, limit: 40000, remaining: 20000 },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => summary,
    });
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = emptySplitSnapshot();

    const result = await tryUsageSummary("token", snapshot, fetchedAt, {}, {}, {});

    expect(result.failed).toBe(false);
    expect(result.snapshot.displayMode).toBe("budget");
    expect(result.snapshot.budgetUsedUsd).toBe(200);
    expect(result.snapshot.budgetLimitUsd).toBe(400);
    expect(result.snapshot.budgetPct).toBe(50);
  });
});
