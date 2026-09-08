import { buildWorkosCookie, userIdFromJwt } from "./auth";
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

export function usageSummaryRequestInit(token: string, useCookie: boolean): RequestInit {
  if (!useCookie) {
    return {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    };
  }
  const userId = userIdFromJwt(token);
  if (!userId) {
    throw new AuthError("Cannot build Cursor session cookie");
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
): Promise<{ snapshot: UsageSnapshot; failed: boolean }> {
  if (!needsUsageSummaryFallback(snapshot)) {
    return { snapshot, failed: false };
  }
  try {
    const summary = await fetchUsageSummary(token);
    return {
      snapshot: mapUsage(period, hardLimit, planInfo, fetchedAt, false, summary),
      failed: false,
    };
  } catch {
    return { snapshot, failed: true };
  }
}

export async function fetchUsageSummary(token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (const useCookie of [false, true]) {
      const response = await fetch(`${WEB_ORIGIN}/api/usage-summary`, {
        ...usageSummaryRequestInit(token, useCookie),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        if (!useCookie) {
          continue;
        }
        throw new AuthError();
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
