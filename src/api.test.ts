import { describe, expect, it } from "vitest";
import { usageSummaryRequestInit } from "./api";

describe("usageSummaryRequestInit", () => {
  it("sends Bearer on the first attempt", () => {
    const init = usageSummaryRequestInit("abc.def.ghi", false);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer abc.def.ghi",
    });
  });

  it("sends the WorkOS cookie on the retry", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_abc" })).toString(
      "base64url",
    );
    const token = `hdr.${payload}.sig`;
    const init = usageSummaryRequestInit(token, true);
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain("WorkosCursorSessionToken=");
    expect(headers.Origin).toBe("https://cursor.com");
    expect(headers.Authorization).toBeUndefined();
  });
});
