# Changelog

## 0.2.2

- Enterprise: if the dashboard RPC returns 401, still load `cursor.com/api/usage-summary` (the endpoint that actually has dollar caps)
- Session cookie tries the full JWT `sub` and the tail after `|`, plus `cursorAuth/cachedUserId`
- Also reads `~/.cursor/auth.json` / `~/.config/cursor/auth.json`

## 0.2.1

- Sign-in copy: a browser login on cursor.com is not enough; use Cursor Settings → Account
- Read `state.vscdb` from this Cursor window’s data folder (office / redirected AppData)
- Also check Insiders / `%LOCALAPPDATA%` paths and `cursorAuth/token`

## 0.2.0

- Enterprise and Teams dollar caps in the status bar (`$used / $limit`)
- Personal Auto / API split unchanged
- Falls back to Cursor usage-summary when the dashboard RPC has no split percents

## 0.1.3

- Marketplace README with status bar, tooltip, and details screenshots

## 0.1.2

- Open VSX publisher is `rijojoy` (id `rijojoy.cursor-usage-split`). The `rijoj` listing is retired.

## 0.1.1

- Open VSX publisher is `rijoj` (id `rijoj.cursor-usage-split`)

## 0.1.0

- Status bar: Cursor % / Other % / on-demand $
- Color by how full each quota is
- Reads local Cursor auth, talks to api2.cursor.sh
