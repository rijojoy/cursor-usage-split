import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  window: { createWebviewPanel: vi.fn() },
}));

import { renderPanelHtml } from "./panel";
import type { UsageSnapshot } from "./usage";

const webview = { cspSource: "csp" } as import("vscode").Webview;

const budgetSnapshot: UsageSnapshot = {
  displayMode: "budget",
  cursorPct: null,
  otherPct: null,
  onDemandUsd: null,
  onDemandPct: null,
  onDemandEnabled: true,
  budgetUsedUsd: 200,
  budgetLimitUsd: 400,
  budgetPct: 50,
  budgetLabel: "Your limit",
  budgetSource: "overall",
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

const proSnapshot: UsageSnapshot = {
  displayMode: "split",
  cursorPct: 42,
  otherPct: 18,
  onDemandUsd: 4.2,
  onDemandPct: 10,
  onDemandEnabled: true,
  budgetUsedUsd: null,
  budgetLimitUsd: null,
  budgetPct: null,
  budgetLabel: null,
  budgetSource: null,
  teamPoolUsedUsd: null,
  teamPoolLimitUsd: null,
  planName: "Pro",
  membershipType: "pro",
  includedUsd: 20,
  cycleStart: null,
  cycleEnd: "2026-10-01T00:00:00.000Z",
  fetchedAt: 1,
  stale: false,
};

describe("renderPanelHtml", () => {
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

  it("uses pooled headline without a secondary team pool card", () => {
    const snapshot: UsageSnapshot = {
      ...budgetSnapshot,
      budgetSource: "pooled",
      teamPoolUsedUsd: 200,
      teamPoolLimitUsd: 400,
    };
    const html = renderPanelHtml(webview, snapshot, 60, 85);
    expect(html).toContain("$200.00 / $400.00");
    expect(html).not.toContain("Team pool");
  });

  it("renders unlimited with an empty fill track", () => {
    const snapshot: UsageSnapshot = {
      ...budgetSnapshot,
      displayMode: "unlimited",
      budgetUsedUsd: null,
      budgetLimitUsd: null,
      budgetPct: null,
      budgetLabel: null,
      budgetSource: null,
      teamPoolUsedUsd: null,
      teamPoolLimitUsd: null,
    };
    const html = renderPanelHtml(webview, snapshot, 60, 85);
    expect(html).toContain("Unlimited");
    expect(html).toContain("width:0%");
  });

  it("adds Cursor and Other cards when budget percents exist", () => {
    const snapshot: UsageSnapshot = {
      ...budgetSnapshot,
      cursorPct: 42,
      otherPct: 18,
    };
    const html = renderPanelHtml(webview, snapshot, 60, 85);
    expect(html).toContain("$200.00 / $400.00");
    expect(html).toContain(">Cursor</p>");
    expect(html).toContain(">Other</p>");
  });

  it("title-cases membershipType in the header when planName is missing", () => {
    const snapshot: UsageSnapshot = {
      ...budgetSnapshot,
      planName: null,
      membershipType: "enterprise",
    };
    const html = renderPanelHtml(webview, snapshot, 60, 85);
    expect(html).toContain('<p class="plan">Enterprise</p>');
    expect(html).not.toContain("Current plan");
  });
});
