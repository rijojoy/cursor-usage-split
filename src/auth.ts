import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs from "sql.js";
import { querySqlite, querySqliteValue, SQLJS_MAX_BYTES, sqlStringLiteral } from "./sqliteQuery";

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"] as const;
const USER_ID_KEYS = ["cursorAuth/cachedUserId", "cursorAuth/userId"] as const;

export function stateDbPathFromExtensionStorage(globalStorageFsPath: string): string {
  return path.normalize(path.join(globalStorageFsPath, "..", "state.vscdb"));
}

export function getStateDbCandidates(
  platform = process.platform,
  env: NodeJS.Dict<string> | NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string[] {
  if (platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
      path.join(home, "Library", "Application Support", "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
    ];
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      path.join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      path.join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }
  return [
    path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(home, ".config", "cursor", "User", "globalStorage", "state.vscdb"),
  ];
}

export function getStateDbPath(
  platform = process.platform,
  env: NodeJS.Dict<string> | NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  return getStateDbCandidates(platform, env, home)[0];
}

export function uniqueDbPaths(paths: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function looksLikeUtf16LeBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) {
    return false;
  }
  const sample = Math.min(bytes.length, 64);
  let zeros = 0;
  for (let i = 1; i < sample; i += 2) {
    if (bytes[i] === 0) {
      zeros += 1;
    }
  }
  return zeros >= sample / 4;
}

export function decodeSqliteText(value: string | Uint8Array): string {
  if (typeof value === "string") {
    return value.includes("\u0000") ? value.replace(/\u0000/g, "") : value;
  }
  if (looksLikeUtf16LeBytes(value)) {
    return new TextDecoder("utf-16le").decode(value);
  }
  return new TextDecoder("utf-8").decode(value);
}

export function parseStoredAccessToken(raw: string): string | null {
  let value = decodeSqliteText(raw).trim();
  if (value.startsWith('"')) {
    try {
      value = JSON.parse(value) as string;
    } catch {
      value = value.replace(/^"|"$/g, "");
    }
  }
  return value || null;
}

function jwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { sub?: unknown };
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

export function userIdFromJwt(token: string): string | null {
  const sub = jwtSub(token);
  if (!sub) {
    return null;
  }
  const pipe = sub.lastIndexOf("|");
  return pipe >= 0 ? sub.slice(pipe + 1) : sub;
}

export function cookieUserIdsFromJwt(token: string): string[] {
  const sub = jwtSub(token);
  if (!sub) {
    return [];
  }
  const ids = [sub];
  const tail = userIdFromJwt(token);
  if (tail && tail !== sub) {
    ids.push(tail);
  }
  return ids;
}

export function parseAuthJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { accessToken?: unknown; access_token?: unknown };
    const token = parsed.accessToken ?? parsed.access_token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function authJsonCandidates(home = os.homedir()): string[] {
  return [
    path.join(home, ".config", "cursor", "auth.json"),
    path.join(home, ".cursor", "auth.json"),
  ];
}

export function buildWorkosCookie(userId: string, token: string): string {
  return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`;
}

let sqlJsPromise: Promise<unknown> | null = null;

export type AuthBundle = {
  token: string | null;
  cachedUserId: string | null;
  keys: string[];
};

export async function readAuthBundleFromBytes(
  bytes: Uint8Array,
  wasmPath?: string,
): Promise<AuthBundle> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs(
      wasmPath
        ? {
            locateFile: (file: string) =>
              file.endsWith(".wasm") ? wasmPath : file,
          }
        : undefined,
    );
  }
  const SQL = (await sqlJsPromise) as {
    Database: new (data: Uint8Array) => {
      prepare: (sql: string) => {
        step: () => boolean;
        getAsObject: () => { value?: unknown; key?: unknown };
        free: () => void;
      };
      close: () => void;
    };
  };
  const db = new SQL.Database(bytes);
  try {
    const readValue = (key: string): string | null => {
      const stmt = db.prepare(`SELECT value FROM ItemTable WHERE key = '${key}' LIMIT 1`);
      let raw: string | null = null;
      if (stmt.step()) {
        const v = stmt.getAsObject().value;
        if (typeof v === "string") {
          raw = decodeSqliteText(v);
        } else if (v instanceof Uint8Array) {
          raw = decodeSqliteText(v);
        } else if (v != null) {
          raw = decodeSqliteText(String(v));
        }
      }
      stmt.free();
      return raw ? parseStoredAccessToken(raw) : null;
    };
    let token: string | null = null;
    for (const key of ACCESS_TOKEN_KEYS) {
      token = readValue(key);
      if (token) {
        break;
      }
    }
    let cachedUserId: string | null = null;
    for (const key of USER_ID_KEYS) {
      cachedUserId = readValue(key);
      if (cachedUserId) {
        break;
      }
    }
    const keyStmt = db.prepare("SELECT key FROM ItemTable WHERE key LIKE 'cursorAuth/%'");
    const keys: string[] = [];
    while (keyStmt.step()) {
      const k = keyStmt.getAsObject().key;
      if (typeof k === "string") {
        keys.push(k);
      }
    }
    keyStmt.free();
    return { token, cachedUserId, keys };
  } finally {
    db.close();
  }
}

export async function readAccessTokenFromBytes(
  bytes: Uint8Array,
  wasmPath?: string,
): Promise<string | null> {
  const bundle = await readAuthBundleFromBytes(bytes, wasmPath);
  return bundle.token;
}

export function readAuthBundleFromFile(dbPath: string): AuthBundle & { method: string; error?: string; sizeBytes: number } {
  const sizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  let method: string = "none";
  let error: string | undefined;
  let token: string | null = null;
  let cachedUserId: string | null = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    const queried = querySqliteValue(dbPath, `SELECT value FROM ItemTable WHERE key = ${sqlStringLiteral(key)} LIMIT 1`);
    method = queried.method ?? method;
    error = queried.error;
    if (queried.value) {
      token = parseStoredAccessToken(queried.value);
      if (token) {
        break;
      }
    }
  }
  if (method !== "none") {
    for (const key of USER_ID_KEYS) {
      const queried = querySqliteValue(dbPath, `SELECT value FROM ItemTable WHERE key = ${sqlStringLiteral(key)} LIMIT 1`);
      if (queried.value) {
        cachedUserId = parseStoredAccessToken(queried.value);
        if (cachedUserId) {
          break;
        }
      }
    }
    const keysQuery = querySqlite(dbPath, "SELECT key FROM ItemTable WHERE key LIKE 'cursorAuth/%'");
    const keys = keysQuery.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return { token, cachedUserId, keys, method, sizeBytes };
  }
  return { token: null, cachedUserId: null, keys: [], method: "none", error, sizeBytes };
}

export type AuthProbe = {
  path: string;
  exists: boolean;
  token: boolean;
  kind: "sqlite" | "auth.json" | "secret";
  method?: string;
  error?: string;
  sizeBytes?: number;
};

export type CursorSession = {
  token: string;
  userIds: string[];
  source: string;
};

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sessionFromToken(token: string, source: string, extraUserId?: string | null): CursorSession {
  return {
    token,
    userIds: uniqueIds([...cookieUserIdsFromJwt(token), extraUserId]),
    source,
  };
}

export async function probeAuth(
  wasmPath?: string,
  extraDbPath?: string,
  secretToken?: string,
): Promise<{
  session: CursorSession | null;
  probes: AuthProbe[];
  sqliteKeys: string[];
}> {
  const probes: AuthProbe[] = [];
  let session: CursorSession | null = null;
  let sqliteKeys: string[] = [];

  if (secretToken) {
    session = sessionFromToken(secretToken, "secretStorage");
    probes.push({ path: "secretStorage", exists: true, token: true, kind: "secret" });
  }

  const dbCandidates = uniqueDbPaths([extraDbPath, ...getStateDbCandidates()]);
  for (const dbPath of dbCandidates) {
    const exists = fs.existsSync(dbPath);
    let found = false;
    let method: string | undefined;
    let error: string | undefined;
    let sizeBytes: number | undefined;
    if (exists) {
      const native = readAuthBundleFromFile(dbPath);
      sizeBytes = native.sizeBytes;
      method = native.method;
      error = native.error;
      let bundle = native;
      if (!native.token && native.sizeBytes <= SQLJS_MAX_BYTES) {
        try {
          const bytes = new Uint8Array(fs.readFileSync(dbPath));
          const wasmBundle = await readAuthBundleFromBytes(bytes, wasmPath);
          bundle = { ...wasmBundle, method: "sql.js", sizeBytes: native.sizeBytes };
          method = "sql.js";
          error = undefined;
        } catch (err) {
          error = err instanceof Error ? err.message : "sql.js failed";
        }
      } else if (!native.token && native.sizeBytes > SQLJS_MAX_BYTES) {
        error = native.error
          ? `${native.error}; db is ${Math.round(native.sizeBytes / 1024 / 1024)}MB (sql.js skipped)`
          : `db is ${Math.round(native.sizeBytes / 1024 / 1024)}MB; need sqlite3 or python`;
      }
      if (bundle.keys.length && sqliteKeys.length === 0) {
        sqliteKeys = bundle.keys;
      }
      if (bundle.token) {
        found = true;
        if (!session) {
          session = sessionFromToken(bundle.token, dbPath, bundle.cachedUserId);
        }
      }
    }
    probes.push({ path: dbPath, exists, token: found, kind: "sqlite", method, error, sizeBytes });
  }

  for (const jsonPath of uniqueDbPaths(authJsonCandidates())) {
    const exists = fs.existsSync(jsonPath);
    let found = false;
    if (exists) {
      try {
        const token = parseAuthJson(fs.readFileSync(jsonPath, "utf8"));
        if (token) {
          found = true;
          if (!session) {
            session = sessionFromToken(token, jsonPath);
          }
        }
      } catch {
        // ignore unreadable auth.json
      }
    }
    probes.push({ path: jsonPath, exists, token: found, kind: "auth.json" });
  }

  return { session, probes, sqliteKeys };
}

export async function getSession(
  wasmPath?: string,
  extraDbPath?: string,
  secretToken?: string,
): Promise<CursorSession | null> {
  const { session } = await probeAuth(wasmPath, extraDbPath, secretToken);
  return session;
}

export async function getAccessToken(
  wasmPath?: string,
  extraDbPath?: string,
  secretToken?: string,
): Promise<string | null> {
  const session = await getSession(wasmPath, extraDbPath, secretToken);
  return session?.token ?? null;
}
