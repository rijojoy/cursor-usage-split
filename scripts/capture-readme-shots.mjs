import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "scripts", "readme-shots.html");
const outDir = path.join(root, "media");

const shots = [
  { id: "status", file: "status-bar.png" },
  { id: "tooltip", file: "tooltip.png" },
  { id: "panel", file: "panel.png" },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(`file://${html}`);

for (const shot of shots) {
  const el = page.locator(`#${shot.id}`);
  await el.screenshot({
    path: path.join(outDir, shot.file),
    type: "png",
  });
  console.log("wrote", shot.file);
}

await browser.close();
