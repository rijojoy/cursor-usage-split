import * as path from "path";
import * as vscode from "vscode";
import {
  AuthError,
  fetchUsagePayloads,
  NetworkError,
  RateLimitError,
  tryUsageSummary,
} from "./api";
import { getAccessToken, probeAuth, stateDbPathFromExtensionStorage } from "./auth";
import { BAND_HEX, statusBarBand } from "./colors";
import { formatStatusBar } from "./format";
import { getLog, logError, logInfo } from "./log";
import { DASHBOARD_URL, openDetailsPanel, refreshOpenPanel } from "./panel";
import { buildTooltip } from "./tooltip";
import { mapUsage, needsUsageSummaryFallback, type UsageSnapshot } from "./usage";

let statusBar: vscode.StatusBarItem | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let lastSnapshot: UsageSnapshot | undefined;
let intervalMs = 10_000;
let wasmPath: string | undefined;
let extraDbPath: string | undefined;

function cfg() {
  return vscode.workspace.getConfiguration("cursorUsageSplit");
}

function thresholds(): { warningPercent: number; criticalPercent: number } {
  return {
    warningPercent: cfg().get<number>("warningPercent", 60),
    criticalPercent: cfg().get<number>("criticalPercent", 85),
  };
}

function configuredInterval(): number {
  return Math.max(10_000, cfg().get<number>("refreshIntervalMs", 10_000));
}

function showStatusBar(): boolean {
  return cfg().get<boolean>("showStatusBar", true);
}

function applyBar(kind: "ok" | "loading" | "sign-in" | "auth", snapshot?: UsageSnapshot): void {
  if (!statusBar) {
    return;
  }
  if (!showStatusBar()) {
    statusBar.hide();
    return;
  }
  statusBar.text = formatStatusBar(kind, snapshot);
  statusBar.backgroundColor = undefined;
  if (kind === "ok" && snapshot) {
    const t = thresholds();
    statusBar.color = BAND_HEX[statusBarBand(snapshot, t.warningPercent, t.criticalPercent)];
    statusBar.tooltip = buildTooltip(snapshot, t.warningPercent, t.criticalPercent);
  } else if (kind === "sign-in") {
    statusBar.color = undefined;
    statusBar.tooltip =
      "Sign in via Cursor Settings → Account (a browser login on cursor.com is not enough), then reload the window.";
  } else if (kind === "auth") {
    statusBar.color = undefined;
    statusBar.tooltip = "Token stale — sign in to Cursor again, then reload the window.";
  } else {
    statusBar.color = undefined;
    statusBar.tooltip = "Fetching Cursor usage…";
  }
  statusBar.show();
}

function schedule(nextMs: number): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    void tick();
  }, nextMs);
}

async function tick(force = false): Promise<void> {
  if (inFlight && !force) {
    return;
  }
  inFlight = true;
  try {
    const token = await getAccessToken(wasmPath, extraDbPath);
    if (!token) {
      applyBar("sign-in");
      intervalMs = configuredInterval();
      return;
    }

    const payloads = await fetchUsagePayloads(token);
    const fetchedAt = Date.now();
    let snapshot = mapUsage(
      payloads.period,
      payloads.hardLimit,
      payloads.planInfo,
      fetchedAt,
      false,
    );
    const needsFallback = needsUsageSummaryFallback(snapshot);
    const summaryResult = await tryUsageSummary(
      token,
      snapshot,
      fetchedAt,
      payloads.period,
      payloads.hardLimit,
      payloads.planInfo,
    );
    snapshot = summaryResult.snapshot;
    if (summaryResult.failed) {
      snapshot = { ...snapshot, stale: true };
      intervalMs = Math.min(60_000, intervalMs * 2);
      logError("usage-summary failed");
    } else {
      if (needsFallback) {
        logInfo(
          `usage-summary fallback displayMode=${snapshot.displayMode} source=${snapshot.budgetSource ?? "none"}`,
        );
      }
      intervalMs = configuredInterval();
    }
    lastSnapshot = snapshot;
    applyBar("ok", snapshot);
    const t = thresholds();
    refreshOpenPanel(snapshot, t.warningPercent, t.criticalPercent);
    logInfo(
      `usage refreshed displayMode=${snapshot.displayMode} source=${snapshot.budgetSource ?? "none"}`,
    );
  } catch (error) {
    if (error instanceof AuthError) {
      applyBar("auth");
      logError("auth failed");
    } else if (error instanceof RateLimitError || error instanceof NetworkError) {
      if (lastSnapshot) {
        const stale = { ...lastSnapshot, stale: true };
        lastSnapshot = stale;
        applyBar("ok", stale);
      }
      intervalMs = Math.min(60_000, intervalMs * 2);
      logError(error instanceof Error ? error.message : "fetch failed");
    } else {
      logError(error instanceof Error ? error.message : "unknown error");
    }
  } finally {
    inFlight = false;
    schedule(intervalMs);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  wasmPath = path.join(context.extensionPath, "media", "sql-wasm.wasm");
  extraDbPath = stateDbPathFromExtensionStorage(context.globalStorageUri.fsPath);
  intervalMs = configuredInterval();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  statusBar.command = "cursorUsageSplit.openDetails";
  context.subscriptions.push(statusBar);
  applyBar("loading");

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorUsageSplit.refresh", () => {
      void tick(true);
    }),
    vscode.commands.registerCommand("cursorUsageSplit.openDetails", () => {
      openDetailsPanel(
        context,
        () => lastSnapshot,
        thresholds,
        () => {
          void tick(true);
        },
      );
    }),
    vscode.commands.registerCommand("cursorUsageSplit.openDashboard", () => {
      void vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
    }),
    vscode.commands.registerCommand("cursorUsageSplit.diagnoseAuth", async () => {
      const { token, probes } = await probeAuth(wasmPath, extraDbPath);
      const used = probes.find((p) => p.token)?.path;
      logInfo(`diagnose token=${token ? "yes" : "no"} extraDbPath=${extraDbPath ?? ""}`);
      for (const probe of probes) {
        logInfo(
          `diagnose path=${probe.path} exists=${probe.exists ? "yes" : "no"} token=${probe.token ? "yes" : "no"}`,
        );
      }
      if (token) {
        void vscode.window.showInformationMessage(
          `Access token found${used ? ` at ${used}` : ""}. If the bar still says Auth, reload the window.`,
        );
        return;
      }
      getLog().show(true);
      void vscode.window.showInformationMessage(
        "No Cursor app token. Sign in via Cursor Settings → Account (not the browser), then Developer: Reload Window. See Cursor Usage Split output for paths checked.",
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("cursorUsageSplit")) {
        intervalMs = configuredInterval();
        if (lastSnapshot) {
          applyBar("ok", lastSnapshot);
        }
      }
    }),
  );

  void tick(true);
}

export function deactivate(): void {
  if (timer) {
    clearTimeout(timer);
  }
}
