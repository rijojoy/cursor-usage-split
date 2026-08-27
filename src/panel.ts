import * as vscode from "vscode";
import { BAND_HEX, colorBand } from "./colors";
import { formatPercent, formatUsd } from "./format";
import type { UsageSnapshot } from "./usage";

export const DASHBOARD_URL = "https://cursor.com/dashboard/usage";

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function formatWhen(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatReset(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function gaugeHtml(
  label: string,
  value: string,
  sub: string,
  pct: number | null,
  hex: string,
): string {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
  return `<article class="card">
    <p class="label">${label}</p>
    <p class="value" style="color:${hex}">${value}</p>
    <p class="sub">${sub}</p>
    <div class="track"><div class="fill" style="width:${width}%;background:${hex}"></div></div>
  </article>`;
}

export function renderPanelHtml(
  webview: vscode.Webview,
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): string {
  const n = nonce();
  const cursorBand = colorBand(snapshot.cursorPct, warningPercent, criticalPercent);
  const otherBand = colorBand(snapshot.otherPct, warningPercent, criticalPercent);
  const onDemandBand = colorBand(snapshot.onDemandPct, warningPercent, criticalPercent, {
    noCap: snapshot.onDemandPct === null,
  });
  const included =
    snapshot.includedUsd !== null ? `Included spend $${snapshot.includedUsd.toFixed(2)}` : "Included usage";
  const onDemandSub = !snapshot.onDemandEnabled
    ? "On-demand off"
    : snapshot.onDemandPct === null
      ? "no spend limit"
      : `${Math.round(snapshot.onDemandPct)}% of cap`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${n}'; script-src 'nonce-${n}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Usage</title>
  <style nonce="${n}">
    :root { color-scheme: light dark; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    main { max-width: 720px; margin: 0 auto; padding: 24px; }
    header { margin-bottom: 24px; }
    h1 { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; margin: 0 0 8px; }
    .plan { font-size: 20px; font-weight: 600; margin: 0; }
    .meta { margin-top: 6px; opacity: 0.7; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .card { padding: 16px; border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08)); border-radius: 8px; }
    .label { margin: 0; font-size: 12px; opacity: 0.7; }
    .value { margin: 8px 0 4px; font-size: 28px; font-weight: 600; letter-spacing: -0.03em; }
    .sub { margin: 0 0 12px; font-size: 12px; opacity: 0.7; }
    .track { height: 4px; background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent); border-radius: 2px; overflow: hidden; }
    .fill { height: 4px; border-radius: 2px; }
    footer { display: flex; gap: 12px; align-items: center; margin-top: 24px; opacity: 0.85; }
    button, a.btn {
      font: inherit; color: var(--vscode-button-foreground);
      background: var(--vscode-button-background); border: 0; padding: 6px 12px;
      border-radius: 4px; cursor: pointer; text-decoration: none;
    }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Usage</h1>
      <p class="plan">${snapshot.planName ?? "Current plan"}</p>
      <p class="meta">Resets ${formatReset(snapshot.cycleEnd)}${snapshot.stale ? " · retrying" : ""}</p>
    </header>
    <section class="grid">
      ${gaugeHtml("Cursor", formatPercent(snapshot.cursorPct).trim(), included, snapshot.cursorPct, BAND_HEX[cursorBand])}
      ${gaugeHtml("Other", formatPercent(snapshot.otherPct).trim(), "API models", snapshot.otherPct, BAND_HEX[otherBand])}
      ${gaugeHtml("On-demand", formatUsd(snapshot.onDemandUsd), onDemandSub, snapshot.onDemandPct, BAND_HEX[onDemandBand])}
    </section>
    <footer>
      <span>Updated ${formatWhen(snapshot.fetchedAt)}</span>
      <button id="refresh">Refresh</button>
      <a class="btn" href="${DASHBOARD_URL}">Open dashboard</a>
    </footer>
  </main>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    document.getElementById("refresh").addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });
  </script>
</body>
</html>`;
}

let currentPanel: vscode.WebviewPanel | undefined;

export function openDetailsPanel(
  context: vscode.ExtensionContext,
  getSnapshot: () => UsageSnapshot | undefined,
  getThresholds: () => { warningPercent: number; criticalPercent: number },
  onRefresh: () => void,
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    const snap = getSnapshot();
    if (snap) {
      const t = getThresholds();
      currentPanel.webview.html = renderPanelHtml(currentPanel.webview, snap, t.warningPercent, t.criticalPercent);
    }
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "cursorUsageSplit.details",
    "Usage",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
  currentPanel.webview.onDidReceiveMessage((message: { type?: string }) => {
    if (message?.type === "refresh") {
      onRefresh();
    }
  });
  context.subscriptions.push(currentPanel);

  const snap = getSnapshot();
  const t = getThresholds();
  if (snap) {
    currentPanel.webview.html = renderPanelHtml(currentPanel.webview, snap, t.warningPercent, t.criticalPercent);
  } else {
    currentPanel.webview.html = `<html><body style="font-family:var(--vscode-font-family);padding:24px;">Sign in to Cursor to see usage.</body></html>`;
  }
}

export function refreshOpenPanel(
  snapshot: UsageSnapshot,
  warningPercent: number,
  criticalPercent: number,
): void {
  if (!currentPanel) {
    return;
  }
  currentPanel.webview.html = renderPanelHtml(
    currentPanel.webview,
    snapshot,
    warningPercent,
    criticalPercent,
  );
}
