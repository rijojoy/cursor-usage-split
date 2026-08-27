import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Cursor Usage Split");
  }
  return channel;
}

export function logInfo(message: string): void {
  getLog().appendLine(`[info] ${message}`);
}

export function logError(message: string): void {
  getLog().appendLine(`[error] ${message}`);
}
