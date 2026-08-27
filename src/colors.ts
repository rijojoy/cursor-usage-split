export type Band = "green" | "yellow" | "red";

export const BAND_HEX: Record<Band, string> = {
  green: "#3fb950",
  yellow: "#d29922",
  red: "#f85149",
};

export function colorBand(
  usedPct: number | null,
  warningPercent = 60,
  criticalPercent = 85,
  options?: { noCap?: boolean },
): Band {
  if (options?.noCap || usedPct === null) {
    return "green";
  }
  if (usedPct >= criticalPercent) {
    return "red";
  }
  if (usedPct >= warningPercent) {
    return "yellow";
  }
  return "green";
}

const RANK: Record<Band, number> = { green: 0, yellow: 1, red: 2 };

export function statusBarBand(
  snap: { cursorPct: number | null; otherPct: number | null; onDemandPct: number | null },
  warningPercent = 60,
  criticalPercent = 85,
): Band {
  const bands: Band[] = [
    colorBand(snap.cursorPct, warningPercent, criticalPercent),
    colorBand(snap.otherPct, warningPercent, criticalPercent),
    colorBand(snap.onDemandPct, warningPercent, criticalPercent, {
      noCap: snap.onDemandPct === null,
    }),
  ];
  return bands.reduce((worst, band) => (RANK[band] > RANK[worst] ? band : worst), "green" as Band);
}
