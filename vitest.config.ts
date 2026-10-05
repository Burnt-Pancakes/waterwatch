import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest config for WaterVoice-DMV.
 *
 * - `tsconfigPaths` makes the `@/*` alias resolve the same way it does in Vite.
 * - DB-touching tests live under `tests/db` and require the explicit
 *   `RUN_DB_INTEGRATION_TESTS=true` opt-in as well as Supabase credentials.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary", "json"],
      include: ["src/lib/**/*.ts"],
      exclude: [
        "**/*.spec.ts",
        "**/seed/**",
        "**/migrations/**",
        "src/types/**",
        "src/integrations/**",
      ],
      // Thresholds set to actual coverage minus 2% buffer (measured 2026-06-01):
      // statements 94.65%, branches 88.53%, functions 90.66%, lines 95.78%
      thresholds: { lines: 93, functions: 88, branches: 86, statements: 92 },
    },
  },
});
