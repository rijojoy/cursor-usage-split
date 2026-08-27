import * as vscode from "vscode";
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

export function buildTooltip(
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  md.isTrusted = true;

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

  md.appendMarkdown(`**Cursor** (Auto + Composer) &nbsp; <span style="color:${BAND_HEX[cursorBand]};">${formatPercent(snapshot.cursorPct).trim()}</span>\n`);
  md.appendMarkdown(bar(snapshot.cursorPct, BAND_HEX[cursorBand]));
  md.appendMarkdown(`**Other** (API models) &nbsp; <span style="color:${BAND_HEX[otherBand]};">${formatPercent(snapshot.otherPct).trim()}</span>\n`);
  md.appendMarkdown(bar(snapshot.otherPct, BAND_HEX[otherBand]));
  md.appendMarkdown(`**On-demand** &nbsp; <span style="color:${BAND_HEX[onDemandBand]};">${formatUsd(snapshot.onDemandUsd)}</span>\n`);
  md.appendMarkdown(`<span style="opacity:0.7;">${onDemandSub}</span>\n`);
  md.appendMarkdown(bar(snapshot.onDemandPct, BAND_HEX[onDemandBand]));
  md.appendMarkdown(`\n${snapshot.planName ?? "Plan"} · resets ${formatReset(snapshot.cycleEnd)}`);
  if (snapshot.stale) {
    md.appendMarkdown(`\n\nLast updated · retrying`);
  }
  return md;
}
