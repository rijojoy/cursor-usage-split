import { describe, expect, it } from "vitest";
import { colorBand, statusBarBand } from "./colors";

describe("colorBand", () => {
  it("is green below the warning threshold", () => {
    expect(colorBand(59)).toBe("green");
  });

  it("is yellow from warning through just under critical", () => {
    expect(colorBand(60)).toBe("yellow");
    expect(colorBand(84)).toBe("yellow");
  });

  it("is red at and above critical", () => {
    expect(colorBand(85)).toBe("red");
    expect(colorBand(120)).toBe("red");
  });

  it("honors custom thresholds", () => {
    expect(colorBand(50, 40, 70)).toBe("yellow");
    expect(colorBand(70, 40, 70)).toBe("red");
  });

  it("stays green when there is no cap or the percent is unavailable", () => {
    expect(colorBand(null)).toBe("green");
    expect(colorBand(99, 60, 85, { noCap: true })).toBe("green");
  });
});

describe("statusBarBand", () => {
  it("is green when Cursor usage is low", () => {
    expect(statusBarBand({ cursorPct: 5, otherPct: 0, onDemandPct: null })).toBe("green");
  });

  it("uses the worst of the three quotas", () => {
    expect(statusBarBand({ cursorPct: 5, otherPct: 90, onDemandPct: null })).toBe("red");
    expect(statusBarBand({ cursorPct: 5, otherPct: 70, onDemandPct: null })).toBe("yellow");
  });

  it("ignores on-demand when there is no cap", () => {
    expect(statusBarBand({ cursorPct: 5, otherPct: 5, onDemandPct: null })).toBe("green");
  });
});
