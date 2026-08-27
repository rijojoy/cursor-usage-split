import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs from "sql.js";

export function getStateDbPath(platform = process.platform, env = process.env, home = os.homedir()): string {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (platform === "win32") {
    return path.join(env.APPDATA || "", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

export function parseStoredAccessToken(raw: string): string | null {
  let value = raw.trim();
  if (value.startsWith('"')) {
    try {
      value = JSON.parse(value) as string;
    } catch {
      value = value.replace(/^"|"$/g, "");
    }
  }
  return value || null;
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
    const stmt = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1",
    );
    let raw: string | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      const v = row.value;
      if (typeof v === "string") {
        raw = v;
      } else if (v instanceof Uint8Array) {
        raw = new TextDecoder().decode(v);
      } else if (v != null) {
        raw = String(v);
      }
    }
    stmt.free();
    return raw ? parseStoredAccessToken(raw) : null;
  } finally {
    db.close();
  }
}

export async function getAccessToken(wasmPath?: string): Promise<string | null> {
  const dbPath = getStateDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return null;
  }
  const bytes = new Uint8Array(fs.readFileSync(dbPath));
  return readAccessTokenFromBytes(bytes, wasmPath);
}
