export const ECOLI_PASS_THRESHOLD = 235;
export const ECOLI_CAUTION_MAX = 410;
export const ENTERO_PASS_THRESHOLD = 35;
export const ENTERO_CAUTION_MAX = 130;

function classify(
  v: number | null,
  pass: number,
  caution: number,
): "pass" | "caution" | "unsafe" | null {
  if (v == null || !isFinite(v)) return null;
  if (v <= pass) return "pass";
  if (v <= caution) return "caution";
  return "unsafe";
}

const SEVERITY: Record<string, number> = { pass: 0, caution: 1, unsafe: 2 };

export function computeStatus(
  eColiMpn: number | null,
  enterococciCce: number | null,
  waterBodyType: string,
): string {
  const ecoli = classify(eColiMpn, ECOLI_PASS_THRESHOLD, ECOLI_CAUTION_MAX);
  const entero = classify(enterococciCce, ENTERO_PASS_THRESHOLD, ENTERO_CAUTION_MAX);

  const candidates: string[] = [];
  if (waterBodyType === "freshwater") {
    if (ecoli) candidates.push(ecoli);
    if (entero) candidates.push(entero);
  } else {
    if (entero) candidates.push(entero);
    if (ecoli) candidates.push(ecoli);
  }

  if (!candidates.length) return "no_data";
  return candidates.reduce((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc));
}

export function shouldFireAlert(
  triggerOn: string[],
  oldStatus: string,
  newStatus: string,
): boolean {
  if (oldStatus === newStatus) return false;
  return triggerOn.includes(newStatus);
}
