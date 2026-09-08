import { buildWorkosCookie, cookieUserIdsFromJwt } from "./auth";
import { mapUsage, needsUsageSummaryFallback, type UsageSnapshot } from "./usage";

const API_ORIGIN = "https://api2.cursor.sh";
const WEB_ORIGIN = "https://cursor.com";

export class AuthError extends Error {
  constructor(message = "Cursor API returned 401/403") {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(message = "Cursor API returned 429") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

async function postDashboard(path: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new AuthError();
    }
    if (response.status === 429) {
      throw new RateLimitError();
    }
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(error instanceof Error ? error.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}

export type UsagePayloads = {
  period: unknown;
  hardLimit: unknown;
  planInfo: unknown;
};

export async function fetchUsagePayloads(token: string): Promise<UsagePayloads> {
  const [period, hardLimit, planInfo] = await Promise.all([
    postDashboard("/aiserver.v1.DashboardService/GetCurrentPeriodUsage", token),
    postDashboard("/aiserver.v1.DashboardService/GetHardLimit", token),
    postDashboard("/aiserver.v1.DashboardService/GetPlanInfo", token),
  ]);
  return { period, hardLimit, planInfo };
}

export function usageSummaryRequestInit(token: string, userId?: string): RequestInit {
  if (!userId) {
    return {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    };
  }
  return {
    method: "GET",
    headers: {
      Cookie: buildWorkosCookie(userId, token),
      Origin: WEB_ORIGIN,
      Accept: "application/json",
    },
  };
}

export async function tryUsageSummary(
  token: string,
  snapshot: UsageSnapshot,
  fetchedAt: number,
  period: unknown,
  hardLimit: unknown,
  planInfo: unknown,
  userIds: string[] = cookieUserIdsFromJwt(token),
): Promise<{ snapshot: UsageSnapshot; failed: boolean }> {
  if (!needsUsageSummaryFallback(snapshot)) {
    return { snapshot, failed: false };
  }
  try {
    const summary = await fetchUsageSummary(token, userIds);
    return {
      snapshot: mapUsage(period, hardLimit, planInfo, fetchedAt, false, summary),
      failed: false,
    };
  } catch {
    return { snapshot, failed: true };
  }
}

export async function fetchUsageSummary(
  token: string,
  userIds: string[] = cookieUserIdsFromJwt(token),
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const attempts: (string | undefined)[] = [undefined, ...userIds];
  try {
    for (const userId of attempts) {
      const response = await fetch(`${WEB_ORIGIN}/api/usage-summary`, {
        ...usageSummaryRequestInit(token, userId),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        continue;
      }
      if (response.status === 429) {
        throw new RateLimitError();
      }
      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    }
    throw new AuthError();
  } catch (error) {
    if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(error instanceof Error ? error.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}

export function snapshotHasMeter(
  snapshot: Pick<
    UsageSnapshot,
    "displayMode" | "cursorPct" | "otherPct" | "budgetUsedUsd" | "budgetLimitUsd"
  >,
): boolean {
  return (
    snapshot.displayMode === "unlimited" ||
    snapshot.displayMode === "budget" ||
    snapshot.cursorPct !== null ||
    snapshot.otherPct !== null ||
    snapshot.budgetUsedUsd !== null ||
    snapshot.budgetLimitUsd !== null
  );
}

export async function loadUsageSnapshot(
  token: string,
  fetchedAt: number,
  userIds: string[] = cookieUserIdsFromJwt(token),
): Promise<{
  snapshot: UsageSnapshot;
  summaryFailed: boolean;
  connectAuthFailed: boolean;
}> {
  let period: unknown = null;
  let hardLimit: unknown = null;
  let planInfo: unknown = null;
  let connectAuthFailed = false;
  try {
    const payloads = await fetchUsagePayloads(token);
    period = payloads.period;
    hardLimit = payloads.hardLimit;
    planInfo = payloads.planInfo;
  } catch (error) {
    if (error instanceof AuthError) {
      connectAuthFailed = true;
    } else {
      throw error;
    }
  }
  const snapshot = mapUsage(period, hardLimit, planInfo, fetchedAt, false);
  const summaryResult = await tryUsageSummary(
    token,
    snapshot,
    fetchedAt,
    period,
    hardLimit,
    planInfo,
    userIds,
  );
  return {
    snapshot: summaryResult.snapshot,
    summaryFailed: summaryResult.failed,
    connectAuthFailed,
  };
}
