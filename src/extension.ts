import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AuthError, fetchUsagePayloads, NetworkError, RateLimitError } from "./api";
import { getAccessToken, getStateDbPath } from "./auth";
import { BAND_HEX, statusBarBand } from "./colors";
import { formatStatusBar } from "./format";
import { logError, logInfo } from "./log";
import { DASHBOARD_URL, openDetailsPanel, refreshOpenPanel } from "./panel";
import { buildTooltip } from "./tooltip";
import { mapUsage, type UsageSnapshot } from "./usage";

let statusBar: vscode.StatusBarItem | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let lastSnapshot: UsageSnapshot | undefined;
let intervalMs = 10_000;
let wasmPath: string | undefined;

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
    statusBar.tooltip = "Sign in to Cursor, then reload the window.";
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
    const token = await getAccessToken(wasmPath);
    if (!token) {
      applyBar("sign-in");
      intervalMs = configuredInterval();
      return;
    }

    const payloads = await fetchUsagePayloads(token);
    const snapshot = mapUsage(
      payloads.period,
      payloads.hardLimit,
      payloads.planInfo,
      Date.now(),
      false,
    );
    lastSnapshot = snapshot;
    applyBar("ok", snapshot);
    const t = thresholds();
    refreshOpenPanel(snapshot, t.warningPercent, t.criticalPercent);
    intervalMs = configuredInterval();
    logInfo("usage refreshed");
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
      const dbPath = getStateDbPath();
      const exists = fs.existsSync(dbPath);
      const token = await getAccessToken(wasmPath);
      const lines = [
        `Database: ${dbPath}`,
        `Exists: ${exists ? "yes" : "no"}`,
        `Access token: ${token ? "found" : "missing"}`,
        token ? "Sign-in looks OK. If the bar still says Auth, reload the window." : "Sign in to Cursor, then reload the window.",
      ];
      void vscode.window.showInformationMessage(lines.join(" · "));
      logInfo(`diagnose exists=${exists} token=${token ? "yes" : "no"}`);
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
