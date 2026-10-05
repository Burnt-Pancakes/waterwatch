// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AccountPage } from "./account";

afterEach(cleanup);

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({ options: {}, update: () => ({}) }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { email: "test@example.com", id: "uid-123" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

vi.mock("@/lib/userProfile.functions", () => ({
  getUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  listUserAlerts: vi.fn(),
  deleteUserAlertById: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

describe("Account page", () => {
  it("renders profile section with display name input", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("profile-display-name")).toBeTruthy();
  });

  it("renders alerts empty state when there are no alerts", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("alerts-empty-state")).toBeTruthy();
  });

  it("sign out button is accessible", () => {
    render(<AccountPage />);
    const btn = screen.getByTestId("sign-out-btn");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("delete account button is accessible", () => {
    render(<AccountPage />);
    const btn = screen.getByTestId("delete-account-btn");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("email alerts toggle is rendered", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("email-alerts-toggle")).toBeTruthy();
  });
});
