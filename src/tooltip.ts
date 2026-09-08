import type * as vscode from "vscode";
import { BAND_HEX, colorBand } from "./colors";
import { formatPercent, formatUsd } from "./format";
import type { UsageSnapshot } from "./usage";

function bar(pct: number | null, hex: string): string {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
  return `<div style="margin:4px 0 10px 0;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden;"><div style="width:${width}%;height:4px;background:${hex};"></div></div>`;
}

function formatReset(iso: string | null): string {
  if (!iso) {
    return "unknown";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function splitTooltipLines(
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): string[] {
  const lines: string[] = [];
  const cursorBand = colorBand(snapshot.cursorPct, warningPercent, criticalPercent);
  const otherBand = colorBand(snapshot.otherPct, warningPercent, criticalPercent);
  const onDemandBand = colorBand(snapshot.onDemandPct, warningPercent, criticalPercent, {
    noCap: snapshot.onDemandPct === null,
  });

  const onDemandSub = !snapshot.onDemandEnabled
    ? "On-demand off"
    : snapshot.onDemandPct === null
      ? "no spend limit"
      : `${Math.round(snapshot.onDemandPct)}% of cap`;

  lines.push(
    `**Cursor** (Auto + Composer) &nbsp; <span style="color:${BAND_HEX[cursorBand]};">${formatPercent(snapshot.cursorPct).trim()}</span>`,
  );
  lines.push(bar(snapshot.cursorPct, BAND_HEX[cursorBand]));
  lines.push(
    `**Other** (API models) &nbsp; <span style="color:${BAND_HEX[otherBand]};">${formatPercent(snapshot.otherPct).trim()}</span>`,
  );
  lines.push(bar(snapshot.otherPct, BAND_HEX[otherBand]));
  lines.push(
    `**On-demand** &nbsp; <span style="color:${BAND_HEX[onDemandBand]};">${formatUsd(snapshot.onDemandUsd)}</span>`,
  );
  lines.push(`<span style="opacity:0.7;">${onDemandSub}</span>`);
  lines.push(bar(snapshot.onDemandPct, BAND_HEX[onDemandBand]));
  lines.push(`\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`);
  if (snapshot.stale) {
    lines.push(`\n\nLast updated · retrying`);
  }
  return lines;
}

export function tooltipLines(
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): string[] {
  if (snapshot.displayMode === "unlimited") {
    const lines = [
      `**Unlimited** — no usage cap on this plan.`,
      `\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`,
    ];
    if (snapshot.stale) {
      lines.push(`\n\nLast updated · retrying`);
    }
    return lines;
  }

  if (snapshot.displayMode === "budget") {
    const band = colorBand(snapshot.budgetPct, warningPercent, criticalPercent, {
      noCap: snapshot.budgetPct === null,
    });
    const label = snapshot.budgetLabel ?? "Usage";
    const lines: string[] = [
      `**${label}** &nbsp; <span style="color:${BAND_HEX[band]};">${formatUsd(snapshot.budgetUsedUsd)} / ${formatUsd(snapshot.budgetLimitUsd)}</span>`,
      bar(snapshot.budgetPct, BAND_HEX[band]),
    ];

    if (snapshot.cursorPct !== null) {
      const cursorBand = colorBand(snapshot.cursorPct, warningPercent, criticalPercent);
      lines.push(
        `**Cursor** (Auto + Composer) &nbsp; <span style="color:${BAND_HEX[cursorBand]};">${formatPercent(snapshot.cursorPct).trim()}</span>`,
      );
      lines.push(bar(snapshot.cursorPct, BAND_HEX[cursorBand]));
    }
    if (snapshot.otherPct !== null) {
      const otherBand = colorBand(snapshot.otherPct, warningPercent, criticalPercent);
      lines.push(
        `**Other** (API models) &nbsp; <span style="color:${BAND_HEX[otherBand]};">${formatPercent(snapshot.otherPct).trim()}</span>`,
      );
      lines.push(bar(snapshot.otherPct, BAND_HEX[otherBand]));
    }
    if (
      snapshot.teamPoolUsedUsd !== null &&
      snapshot.teamPoolLimitUsd !== null &&
      snapshot.budgetSource !== "pooled"
    ) {
      lines.push(
        `<span style="opacity:0.7;">Team pool ${formatUsd(snapshot.teamPoolUsedUsd)} / ${formatUsd(snapshot.teamPoolLimitUsd)}</span>`,
      );
    }
    lines.push(`\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`);
    if (snapshot.stale) {
      lines.push(`\n\nLast updated · retrying`);
    }
    return lines;
  }

  return splitTooltipLines(snapshot, warningPercent, criticalPercent);
}

export function buildTooltip(
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): vscode.MarkdownString {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscodeApi = require("vscode") as typeof import("vscode");
  const md = new vscodeApi.MarkdownString();
  md.supportHtml = true;
  md.isTrusted = true;
  for (const line of tooltipLines(snapshot, warningPercent, criticalPercent)) {
    md.appendMarkdown(`${line}\n`);
  }
  return md;
}
