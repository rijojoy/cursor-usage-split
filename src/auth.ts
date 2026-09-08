import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs from "sql.js";

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"] as const;

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

export function userIdFromJwt(token: string): string | null {
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
    const pipe = payload.sub.lastIndexOf("|");
    return pipe >= 0 ? payload.sub.slice(pipe + 1) : payload.sub;
  } catch {
    return null;
  }
}

export function buildWorkosCookie(userId: string, token: string): string {
  return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`;
}

let sqlJsPromise: Promise<unknown> | null = null;

export async function readAccessTokenFromBytes(
  bytes: Uint8Array,
  wasmPath?: string,
): Promise<string | null> {
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
        getAsObject: () => { value?: unknown };
        free: () => void;
      };
      close: () => void;
    };
  };
  const db = new SQL.Database(bytes);
  try {
    for (const key of ACCESS_TOKEN_KEYS) {
      const stmt = db.prepare(`SELECT value FROM ItemTable WHERE key = '${key}' LIMIT 1`);
      let raw: string | null = null;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        const v = row.value;
        if (typeof v === "string") {
          raw = decodeSqliteText(v);
        } else if (v instanceof Uint8Array) {
          raw = decodeSqliteText(v);
        } else if (v != null) {
          raw = decodeSqliteText(String(v));
        }
      }
      stmt.free();
      const token = raw ? parseStoredAccessToken(raw) : null;
      if (token) {
        return token;
      }
    }
    return null;
  } finally {
    db.close();
  }
}

export type AuthProbe = {
  path: string;
  exists: boolean;
  token: boolean;
};

export async function probeAuth(wasmPath?: string, extraDbPath?: string): Promise<{
  token: string | null;
  probes: AuthProbe[];
}> {
  const candidates = uniqueDbPaths([extraDbPath, ...getStateDbCandidates()]);
  const probes: AuthProbe[] = [];
  let token: string | null = null;
  for (const dbPath of candidates) {
    const exists = fs.existsSync(dbPath);
    let found = false;
    if (exists) {
      try {
        const bytes = new Uint8Array(fs.readFileSync(dbPath));
        const next = await readAccessTokenFromBytes(bytes, wasmPath);
        if (next && !token) {
          token = next;
          found = true;
        } else if (next) {
          found = true;
        }
      } catch {
        // Locked, unreadable, or not sqlite — try the next candidate.
      }
    }
    probes.push({ path: dbPath, exists, token: found });
  }
  return { token, probes };
}

export async function getAccessToken(wasmPath?: string, extraDbPath?: string): Promise<string | null> {
  const { token } = await probeAuth(wasmPath, extraDbPath);
  return token;
}
