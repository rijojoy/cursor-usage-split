import { describe, expect, it } from "vitest";
import { getStateDbPath, parseStoredAccessToken } from "./auth";

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
