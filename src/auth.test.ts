import { describe, expect, it } from "vitest";
import {
  buildWorkosCookie,
  cookieUserIdsFromJwt,
  decodeSqliteText,
  getStateDbCandidates,
  getStateDbPath,
  parseAuthJson,
  parseStoredAccessToken,
  readAccessTokenFromBytes,
  readAuthBundleFromBytes,
  stateDbPathFromExtensionStorage,
  uniqueDbPaths,
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

describe("getStateDbCandidates", () => {
  it("includes LOCALAPPDATA on Windows", () => {
    const paths = getStateDbCandidates(
      "win32",
      {
        APPDATA: "C:\\Users\\ada\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
      },
      "C:\\Users\\ada",
    );
    expect(paths.some((p) => /AppData[\\/]Roaming[\\/]Cursor[\\/]/.test(p))).toBe(true);
    expect(paths.some((p) => /AppData[\\/]Local[\\/]Cursor[\\/]/.test(p))).toBe(true);
    expect(paths.some((p) => /Cursor - Insiders/.test(p))).toBe(true);
  });
});

describe("stateDbPathFromExtensionStorage", () => {
  it("uses the running window's globalStorage sibling", () => {
    expect(
      stateDbPathFromExtensionStorage(
        "/Users/ada/Library/Application Support/Cursor/User/globalStorage/rijojoy.cursor-usage-split",
      ),
    ).toBe(
      "/Users/ada/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  });
});

describe("uniqueDbPaths", () => {
  it("drops empties and duplicates after normalize", () => {
    expect(uniqueDbPaths(["/a/b", undefined, "/a/b", "/a/c"])).toEqual(["/a/b", "/a/c"]);
  });
});

describe("decodeSqliteText", () => {
  it("strips NUL bytes from UTF-16LE-as-string", () => {
    expect(decodeSqliteText("e\0y\0J\0")).toBe("eyJ");
  });

  it("decodes UTF-16LE bytes", () => {
    const bytes = new Uint8Array([0x65, 0x00, 0x79, 0x00, 0x4a, 0x00, 0x22, 0x00]);
    expect(decodeSqliteText(bytes)).toBe('eyJ"');
  });
});

describe("parseStoredAccessToken", () => {
  it("unwraps JSON-quoted sqlite values", () => {
    expect(parseStoredAccessToken('"abc.def.ghi"')).toBe("abc.def.ghi");
  });

  it("returns a bare token", () => {
    expect(parseStoredAccessToken("  abc.def.ghi  ")).toBe("abc.def.ghi");
  });

  it("recovers a NUL-interleaved token", () => {
    expect(parseStoredAccessToken("a\0b\0c\0.\0d\0e\0f")).toBe("abc.def");
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

describe("cookieUserIdsFromJwt", () => {
  it("tries the full sub first, then the tail after the last pipe", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "google-oauth2|user_abc" }),
    ).toString("base64url");
    expect(cookieUserIdsFromJwt(`hdr.${payload}.sig`)).toEqual([
      "google-oauth2|user_abc",
      "user_abc",
    ]);
  });
});

describe("parseAuthJson", () => {
  it("reads accessToken from cursor-agent auth.json", () => {
    expect(parseAuthJson('{"accessToken":"abc.def.ghi"}')).toBe("abc.def.ghi");
  });
});

describe("readAccessTokenFromBytes", () => {
  it("reads cursorAuth/token when accessToken is missing", async () => {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE ItemTable (key TEXT, value TEXT)");
    db.run("INSERT INTO ItemTable VALUES (?, ?)", ["cursorAuth/token", "abc.def.ghi"]);
    const bytes = db.export();
    db.close();
    expect(await readAccessTokenFromBytes(bytes)).toBe("abc.def.ghi");
  });

  it("reads cachedUserId alongside the token", async () => {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE ItemTable (key TEXT, value TEXT)");
    db.run("INSERT INTO ItemTable VALUES (?, ?)", ["cursorAuth/accessToken", "abc.def.ghi"]);
    db.run("INSERT INTO ItemTable VALUES (?, ?)", ["cursorAuth/cachedUserId", "user_abc"]);
    const bytes = db.export();
    db.close();
    const bundle = await readAuthBundleFromBytes(bytes);
    expect(bundle.token).toBe("abc.def.ghi");
    expect(bundle.cachedUserId).toBe("user_abc");
    expect(bundle.keys).toEqual(expect.arrayContaining(["cursorAuth/accessToken", "cursorAuth/cachedUserId"]));
  });
});

describe("buildWorkosCookie", () => {
  it("url-encodes userId::token", () => {
    expect(buildWorkosCookie("user_abc", "tok.en")).toBe(
      "WorkosCursorSessionToken=user_abc%3A%3Atok.en",
    );
  });
});
