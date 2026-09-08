import { describe, expect, it } from "vitest";
import {
  buildWorkosCookie,
  getStateDbPath,
  parseStoredAccessToken,
  userIdFromJwt,
} from "./auth";

describe("getStateDbPath", () => {
  it("resolves the macOS Cursor DB", () => {
    expect(getStateDbPath("darwin", {}, "/Users/ada")).toBe(
      "/Users/ada/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("resolves the Linux Cursor DB", () => {
    expect(getStateDbPath("linux", {}, "/home/ada")).toBe(
      "/home/ada/.config/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("resolves the Windows Cursor DB", () => {
    expect(getStateDbPath("win32", { APPDATA: "C:\\\\Users\\\\ada\\\\AppData\\\\Roaming" }, "C:\\\\Users\\\\ada")).toMatch(
      /Cursor[\\/]User[\\/]globalStorage[\\/]state\.vscdb$/,
    );
  });
});

describe("parseStoredAccessToken", () => {
  it("unwraps JSON-quoted sqlite values", () => {
    expect(parseStoredAccessToken('"abc.def.ghi"')).toBe("abc.def.ghi");
  });

  it("returns a bare token", () => {
    expect(parseStoredAccessToken("  abc.def.ghi  ")).toBe("abc.def.ghi");
  });
});

describe("userIdFromJwt", () => {
  it("takes the segment after the last pipe in sub", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "google-oauth2|user_abc" }),
    ).toString("base64url");
    const token = `hdr.${payload}.sig`;
    expect(userIdFromJwt(token)).toBe("user_abc");
  });

  it("returns the whole sub when there is no pipe", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_abc" })).toString(
      "base64url",
    );
    expect(userIdFromJwt(`hdr.${payload}.sig`)).toBe("user_abc");
  });

  it("returns null for garbage", () => {
    expect(userIdFromJwt("not-a-jwt")).toBeNull();
  });
});

describe("buildWorkosCookie", () => {
  it("url-encodes userId::token", () => {
    expect(buildWorkosCookie("user_abc", "tok.en")).toBe(
      "WorkosCursorSessionToken=user_abc%3A%3Atok.en",
    );
  });
});
