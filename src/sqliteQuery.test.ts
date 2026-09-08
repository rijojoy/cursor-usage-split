import { describe, expect, it } from "vitest";
import { sqlStringLiteral } from "./sqliteQuery";

describe("sqlStringLiteral", () => {
  it("escapes single quotes", () => {
    expect(sqlStringLiteral("cursorAuth/accessToken")).toBe("'cursorAuth/accessToken'");
    expect(sqlStringLiteral("a'b")).toBe("'a''b'");
  });
});
