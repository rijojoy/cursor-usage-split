import { describe, expect, it } from "vitest";
import { formatPercent, formatStatusBar, formatUsd } from "./format";

describe("formatPercent", () => {
  it("pads integers so the chip width stays stable", () => {
    expect(formatPercent(0)).toBe("  0%");
    expect(formatPercent(42)).toBe(" 42%");
    expect(formatPercent(100)).toBe("100%");
  });

  it("does not fake zero for missing values", () => {
    expect(formatPercent(null)).toBe("  —");
  });
});

describe("formatUsd", () => {
  it("always uses two decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.3)).toBe("$12.30");
  });
});

describe("formatStatusBar", () => {
  it("renders the three-way split", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "split",
        cursorPct: 42,
        otherPct: 18,
        onDemandUsd: 4.2,
        stale: false,
      }),
    ).toBe("$(dashboard) Cursor  42% · Other  18% · On-d $4.20");
  });

  it("appends a stale mark", () => {
    expect(
      formatStatusBar("ok", {
        displayMode: "split",
        cursorPct: 42,
        otherPct: 18,
        onDemandUsd: 4.2,
        stale: true,
      }),
    ).toBe("$(dashboard) Cursor  42% · Other  18% · On-d $4.20 ·");
  });

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

  it("renders loading and auth states", () => {
    expect(formatStatusBar("loading")).toBe("$(dashboard) Cursor · Other · On-d …");
    expect(formatStatusBar("sign-in")).toBe("$(dashboard) Usage Split: Sign in");
    expect(formatStatusBar("auth")).toBe("$(dashboard) Usage Split: Auth");
  });
});
