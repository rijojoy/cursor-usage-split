import { spawnSync } from "child_process";
import * as fs from "fs";

export const SQLJS_MAX_BYTES = 64 * 1024 * 1024;

export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type SqliteQueryResult = {
  stdout: string;
  method: "sqlite3" | "python" | null;
  error?: string;
};

function run(bin: string, args: string[]): { status: number | null; stdout: string; stderr: string; error?: string } {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: 12_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) {
    return { status: null, stdout: "", stderr: "", error: result.error.message };
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runSqlite3(dbPath: string, sql: string): SqliteQueryResult {
  const attempts = [
    ["sqlite3", "-readonly", "-noheader", "-batch", dbPath, sql],
    ["sqlite3", "-noheader", "-batch", dbPath, sql],
  ];
  let lastError: string | undefined;
  for (const [bin, ...args] of attempts) {
    const result = run(bin, args);
    if (result.error) {
      lastError = result.error;
      continue;
    }
    if (result.status === 0) {
      return { stdout: result.stdout, method: "sqlite3" };
    }
    lastError = result.stderr.trim() || `sqlite3 exit ${result.status}`;
  }
  return { stdout: "", method: null, error: lastError };
}

const PYTHON_SCRIPT = [
  "import sqlite3, sys",
  "from pathlib import Path",
  "db = Path(sys.argv[1])",
  "sql = sys.argv[2]",
  'uri = db.resolve().as_uri() + "?mode=ro"',
  "con = sqlite3.connect(uri, uri=True)",
  "row = con.execute(sql).fetchone()",
  "if row and row[0] is not None:",
  "    val = row[0] if isinstance(row[0], str) else str(row[0])",
  "    sys.stdout.write(val)",
].join("\n");

function runPython(dbPath: string, sql: string): SqliteQueryResult {
  const launches: { bin: string; args: string[] }[] =
    process.platform === "win32"
      ? [
          { bin: "py", args: ["-3", "-c", PYTHON_SCRIPT, dbPath, sql] },
          { bin: "python", args: ["-c", PYTHON_SCRIPT, dbPath, sql] },
          { bin: "python3", args: ["-c", PYTHON_SCRIPT, dbPath, sql] },
        ]
      : [
          { bin: "python3", args: ["-c", PYTHON_SCRIPT, dbPath, sql] },
          { bin: "python", args: ["-c", PYTHON_SCRIPT, dbPath, sql] },
        ];
  let lastError: string | undefined;
  for (const launch of launches) {
    const result = run(launch.bin, launch.args);
    if (result.error) {
      lastError = result.error;
      continue;
    }
    if (result.status === 0) {
      return { stdout: result.stdout, method: "python" };
    }
    lastError = result.stderr.trim() || `${launch.bin} exit ${result.status}`;
  }
  return { stdout: "", method: null, error: lastError };
}

export function querySqlite(dbPath: string, sql: string): SqliteQueryResult {
  if (!fs.existsSync(dbPath)) {
    return { stdout: "", method: null, error: "missing" };
  }
  const sqlite3 = runSqlite3(dbPath, sql);
  if (sqlite3.method) {
    return sqlite3;
  }
  const python = runPython(dbPath, sql);
  if (python.method) {
    return python;
  }
  return {
    stdout: "",
    method: null,
    error: sqlite3.error || python.error || "sqlite3 and python unavailable",
  };
}

export function querySqliteValue(dbPath: string, sql: string): { value: string | null; method: SqliteQueryResult["method"]; error?: string } {
  const result = querySqlite(dbPath, sql);
  const trimmed = result.stdout.replace(/\r?\n$/, "");
  return {
    value: trimmed.length ? trimmed : null,
    method: result.method,
    error: result.error,
  };
}
