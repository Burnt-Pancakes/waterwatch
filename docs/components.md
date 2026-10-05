# Components

Major components with their props interfaces. All components are mobile-first, verified at 390px width. Dark mode is supported via Tailwind `dark:` prefix.

---

## Map Components

### `WaterVoiceMap`

**File:** `src/components/map/WaterVoiceMap.tsx`

The homepage component. A full-screen MapLibre GL map centered on DC (`[-77.0369, 38.9072]`).

```typescript
export function WaterVoiceMap()  // no props
```

**How it works:**
- Renders a skeleton on the server (SSR guard: `isMounted` flag).
- Lazy-loads `maplibre-gl` via dynamic import inside `useEffect` (MapLibre accesses `window` at module evaluation, so it cannot be imported at the module level in an SSR app).
- Tiles come from `VITE_MAP_TILE_URL` (light) and `VITE_MAP_TILE_URL_DARK` (dark). Defaults: OpenFreeMap Liberty style — no API key required.
- Reads `prefers-color-scheme` to pick the initial tile style.
- Clusters markers using `supercluster` when more than 50 sites are visible.
- Manages a `markerRegistry` (`Map<siteId, {marker, root}>`) to mount/unmount `SiteMarker` React components inside MapLibre `Marker` elements.
- Fetches sites from `/api/sites` on mount.

**Internal state:**
- `isDark` — current color scheme
- `filter: SiteTypeFilter` — active filter pill value
- `sites: SiteFeature[] | null` — loaded sites
- `selectedSite: SiteFeature | null` — drives `SiteBottomSheet`

---

### `SiteBottomSheet`

**File:** `src/components/map/SiteBottomSheet.tsx`

A mobile-native slide-up panel showing site detail when a map marker is tapped.

```typescript
type SiteBottomSheetProps = {
  site: SiteFeature | null;
  onClose: () => void;
};

export function SiteBottomSheet({ site, onClose }: SiteBottomSheetProps)
```

**Features:**
- Drag-to-dismiss gesture (pointer events).
- `StatusBadge` — WCAG-compliant status indicator with `role="status"` and `aria-label`.
- Stale data banner (blue) when reading is older than 7 days.
- Rain advisory banner (amber) when an active rain event exists.
- Activity advisories (swimming / kayaking / wading / fishing) from `getActivityAdvisory`.
- 30-day readings chart (`recharts` `LineChart`) with reference lines at EPA thresholds.
- Favorite star button (auth-gated — prompts sign-in for guests).
- Alert configuration modal (`AlertConfigModal`) for authenticated users.
- Guest alert form (`GuestAlertForm`) for unauthenticated users.
- AI explanation panel (`AIExplanation`) — streams from `/api/explain`.
- Share button using `navigator.share` (Web Share API) or clipboard fallback.
- Legal disclaimer from `DISCLAIMERS.siteCard`.

### `StatusBadge`

```typescript
export function StatusBadge({ status }: { status: SiteStatus })
```

Renders the colored status indicator with icon, label, and WCAG `role="status"` / `aria-label`. Fades in on mount via `requestAnimationFrame`.

---

### `FilterBar`

**File:** `src/components/map/FilterBar.tsx`

Horizontally scrollable pill bar for filtering sites by type. Pinned above the bottom tab bar on mobile.

```typescript
type FilterBarProps = {
  value: SiteTypeFilter;
  onChange: (next: SiteTypeFilter) => void;
};

export function FilterBar({ value, onChange }: FilterBarProps)
```

Pills are generated from `FILTER_OPTIONS` (defined in `filterSites.ts`). Active pill uses the teal primary color; inactive pills are outlined. Scrollbar hidden via CSS.

---

## UI Components

### `BottomTabBar`

**File:** `src/components/ui/BottomTabBar.tsx`

Fixed-position mobile navigation bar with 4 tabs. Hidden on `md` breakpoints and above (desktop uses a different nav pattern).

```typescript
export function BottomTabBar()  // no props
```

**Tabs:**
| Label | Route | Requires auth |
|---|---|---|
| Map | `/` | No |
| List | `/list` | No |
| Favorites | `/favorites` | Yes |
| Account | `/account` | Yes |

Auth-gated tabs redirect to `/auth/sign-in?returnTo={tab.to}` for unauthenticated users. The Favorites tab shows a count badge (red, capped at "9+") when the user has favorites. Uses `safe-area-inset-bottom` for notched iPhones.

---

### `FirstUseDisclaimer`

**File:** `src/components/ui/FirstUseDisclaimer.tsx`

Full-screen modal shown on first visit. Persists acceptance in `localStorage` under key `watervoice_disclaimer_accepted`.

```typescript
export function FirstUseDisclaimer()  // no props
```

- Client-only (SSR guard via `useEffect` + `mounted` flag).
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby="disclaimer-title"`.
- Displays `DISCLAIMERS.firstUse` from the water quality engine.
- Links to `/terms` and `/privacy`.
- Accept button: `data-testid="disclaimer-accept-btn"`.

---

### `InstallPrompt`

**File:** `src/components/ui/InstallPrompt.tsx`

PWA install banner shown after the user's 3rd visit. Uses the browser's `beforeinstallprompt` event.

```typescript
export function InstallPrompt()  // no props
```

**localStorage keys:**
- `watervoice_visit_count` — incremented on each page load
- `watervoice_install_dismissed` — set when user taps "Not now"

Does not show when already running as a PWA (`display-mode: standalone`). Positioned above the bottom tab bar at `bottom-16`.

---

### `SplashScreen`

**File:** `src/components/ui/SplashScreen.tsx`

Full-screen splash shown while the MapLibre map initializes.

```typescript
interface SplashScreenProps {
  isVisible: boolean;
}

export function SplashScreen({ isVisible }: SplashScreenProps)
```

Fades out (opacity transition 500ms) when `isVisible` becomes `false`, then unmounts after the transition completes (500ms `setTimeout`).

---

## Other Notable Components

### `AIExplanation`

**File:** `src/components/site/AIExplanation.tsx`

Renders the AI-generated explanation panel in the bottom sheet. Streams text from `/api/explain` using SSE, displaying it progressively. Shows a "Explain this reading" button before the first request.

### `GuestAlertForm`

**File:** `src/components/site/GuestAlertForm.tsx`

Email subscription form for unauthenticated users. POSTs to `/api/guest-alert`. Shown in `SiteBottomSheet` when no authenticated user is present.

### `AlertConfigModal`

**File:** `src/components/favorites/AlertConfigModal.tsx`

Modal for authenticated users to configure which statuses trigger email alerts for a favorited site. Writes to the `alerts` table.

---

## Radix UI Components

The `src/components/ui/` directory contains the full Radix UI / shadcn component library: `accordion`, `alert`, `alert-dialog`, `aspect-ratio`, `avatar`, `badge`, `button`, `calendar`, `card`, `carousel`, `chart`, `checkbox`, `collapsible`, `command`, `context-menu`, `dialog`, `drawer`, `dropdown-menu`, `form`, `hover-card`, `input`, `input-otp`, `label`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `toast`, `toggle`, `toggle-group`, `tooltip`.

These are standard shadcn/ui components. See the Radix UI docs for their prop interfaces.
