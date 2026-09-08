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
      {
        ...base,
        displayMode: "split",
        cursorPct: 42,
        otherPct: 18,
        onDemandUsd: 4.2,
        budgetUsedUsd: null,
        budgetLimitUsd: null,
        budgetPct: null,
        budgetLabel: null,
        budgetSource: null,
        teamPoolUsedUsd: null,
        teamPoolLimitUsd: null,
        planName: "Pro",
      },
      60,
      85,
    ).join("\n");
    expect(text).toContain("Cursor");
    expect(text).toContain("Other");
    expect(text).toContain("On-demand");
  });
});
