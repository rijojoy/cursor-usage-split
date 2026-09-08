import type { UsageSnapshot } from "./usage";

export function formatPercent(value: number | null): string {
  if (value === null) {
    return "  —";
  }
  return `${Math.round(value)}%`.padStart(4, " ");
}

export function formatUsd(value: number | null): string {
  if (value === null) {
    return "$—.——";
  }
  return `$${value.toFixed(2)}`;
}

export type StatusKind = "ok" | "loading" | "sign-in" | "auth";

export function formatStatusBar(
  kind: StatusKind,
  snapshot?: Pick<
    UsageSnapshot,
    | "displayMode"
    | "cursorPct"
    | "otherPct"
    | "onDemandUsd"
    | "budgetUsedUsd"
    | "budgetLimitUsd"
    | "stale"
  >,
): string {
  if (kind === "loading") {
    return "$(dashboard) Cursor · Other · On-d …";
  }
  if (kind === "sign-in") {
    return "$(dashboard) Usage Split: Sign in";
  }
  if (kind === "auth") {
    return "$(dashboard) Usage Split: Auth";
  }
  if (!snapshot) {
    return "$(dashboard) Cursor · Other · On-d …";
  }
  const stale = snapshot.stale ? " ·" : "";
  if (snapshot.displayMode === "unlimited") {
    return `$(dashboard) Unlimited${stale}`;
  }
  if (snapshot.displayMode === "budget") {
    return `$(dashboard) ${formatUsd(snapshot.budgetUsedUsd)} / ${formatUsd(snapshot.budgetLimitUsd)}${stale}`;
  }
  return `$(dashboard) Cursor ${formatPercent(snapshot.cursorPct)} · Other ${formatPercent(snapshot.otherPct)} · On-d ${formatUsd(snapshot.onDemandUsd)}${stale}`;
}
