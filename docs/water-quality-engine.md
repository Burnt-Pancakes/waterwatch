# Water Quality Engine

**File:** `src/lib/waterQualityEngine.ts`

This is the SAFETY-CRITICAL module of WaterVoice DMV. It is pure TypeScript with no side effects — no network calls, no globals, no randomness. Every function is deterministic: given the same inputs, it always returns the same output.

Do not modify threshold constants without citing the specific regulation that justifies the change.

---

## Threshold Constants

```typescript
export const ECOLI_PASS_THRESHOLD = 235;      // MPN/100mL
export const ECOLI_CAUTION_MAX = 410;         // MPN/100mL
export const ENTERO_PASS_THRESHOLD = 35;      // CCE/100mL
export const ENTERO_CAUTION_MAX = 130;        // CCE/100mL
export const STALE_THRESHOLD_DAYS = 7;        // days
export const RAIN_THRESHOLD_INCHES_48H = 1.0; // inches
```

Standards basis:
- EPA 2012 Recreational Water Quality Criteria (RWQC)
- Virginia DEQ Water Quality Standards (E. coli for freshwater)

---

## `STATUS_CONFIG`

```typescript
export const STATUS_CONFIG: Record<Exclude<WaterStatus, "stale">, StatusConfig>
```

A map from each non-stale status to its full `StatusConfig`. Centralized so every surface (map pin, list row, detail header, email) renders identical color, icon, and copy for a given status. `stale` is intentionally omitted — staleness is an overlay, not a standalone status.

| Status | `safeForSwimming` | `safeForKayaking` | `safeForWading` |
|---|---|---|---|
| `pass` | true | true | true |
| `caution` | false | true | true |
| `unsafe` | false | false | false |
| `no_data` | false | false | false |

---

## `DISCLAIMERS`

```typescript
export const DISCLAIMERS: {
  siteCard: string;
  aiExplanation: string;  // placeholders: {source}, {date}, {agency}
  rainAdvisory: string;
  staleData: string;       // placeholder: {days}
  alertEmail: string;      // placeholder: {source}
  firstUse: string;
  footer: string;
}
```

Plain-text strings with `{placeholder}` tokens for substitution at the call site. This keeps the engine free of any formatting or I/O opinions.

---

## Exported Functions

### `getWaterStatus`

```typescript
export function getWaterStatus(
  eColiMpn: number | null,
  enterococciCce: number | null,
  waterBodyType: "freshwater" | "tidal_brackish",
  _sampledAt: string,
): StatusConfig
```

Derives a display-ready `StatusConfig` from raw bacteria readings.

**Selection rules:**
- `freshwater` → E. coli is the primary indicator; also considers Enterococci if present.
- `tidal_brackish` → Enterococci is the primary indicator; also considers E. coli if present.
- When both indicators are present and classified, the **more conservative (worst)** classification wins — fail-safe by design.
- When neither indicator is present (both null), returns `STATUS_CONFIG.no_data`.

The `_sampledAt` parameter is accepted to keep the function signature consistent with its documentation but is unused inside this function. Staleness is handled separately by `isStaleReading`.

### `isStaleReading`

```typescript
export function isStaleReading(sampledAt: string): boolean
```

Returns `true` when `sampledAt` (ISO 8601 string) is older than `STALE_THRESHOLD_DAYS` (7 days). Boundary condition: exactly 7 days old counts as stale. Invalid/unparseable timestamps are treated as stale — it is better to over-warn than to treat missing data as fresh.

### `shouldShowRainAdvisory`

```typescript
export function shouldShowRainAdvisory(precipInches48h: number): boolean
```

Returns `true` when `precipInches48h >= RAIN_THRESHOLD_INCHES_48H` (1.0 inch). Stormwater runoff is the dominant driver of acute bacteria spikes in the DMV watershed; a 1.0" / 48h event routinely elevates bacteria above safe contact levels even when the last official sample was clean.

### `calculateGeometricMean`

```typescript
export function calculateGeometricMean(readings: number[]): number | null
```

Computes the geometric mean of a readings array per EPA statistical guidance. Returns `null` when fewer than 5 readings are supplied (EPA 2012 RWQC requires a minimum of 5 samples for a statistically valid GM).

**Zero handling:** A single zero would collapse the GM to zero. The standard 0.5 substitution method is applied — zeros and negative values are replaced with 0.5. Log-space summation is used to avoid overflow on long series.

### `getActivityAdvisory`

```typescript
export function getActivityAdvisory(
  status: WaterStatus,
  activity: "swimming" | "kayaking" | "wading" | "fishing",
): string
```

Returns a single-paragraph advisory string for a given activity at a given water status. Risk ordering (highest to lowest): swimming > wading > kayaking > fishing. Swimming involves full immersion and likely water ingestion; fishing from shore/boat involves no immersion.

Hard rules enforced by tests:
- Never assert "you will not get sick"
- Never claim "100% safe"
- Always reference EPA guidelines and frame output as advisory

All outputs end with: `"Guidance is advisory only, based on EPA 2012 RWQC thresholds, and not a regulatory determination."`

---

## Internal Helper (not exported)

### `classifyValue`

```typescript
function classifyValue(
  value: number | null,
  passMax: number,
  cautionMax: number,
): "pass" | "caution" | "unsafe" | null
```

Classifies a single value against a threshold pair. Returns `null` when the value is null, undefined, or NaN. Used internally by `getWaterStatus` to evaluate E. coli and Enterococci independently before reconciliation.
