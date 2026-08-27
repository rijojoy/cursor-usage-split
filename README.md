# Cursor Usage Split

Shows Cursor included usage (Auto vs API) and on-demand spend in the status bar.

```
Cursor 42% · Other 18% · On-d $4.20
```

Turns green / yellow / red at 60% and 85%. Polls every 10s. Uses the login Cursor already stored; the only network calls go to `api2.cursor.sh`.

Unofficial. If Cursor changes that API, this breaks.

## Install

Cursor → Extensions → search **Cursor Usage Split**.

From a vsix:

```
cursor --install-extension cursor-usage-split-0.1.1.vsix
```

## Settings

`cursorUsageSplit.refreshIntervalMs` (min 10000), `cursorUsageSplit.warningPercent`, `cursorUsageSplit.criticalPercent`, `cursorUsageSplit.showStatusBar`.

## License

MIT. Not affiliated with Cursor.
