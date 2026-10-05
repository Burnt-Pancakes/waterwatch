import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./resend.server";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.RESEND_API_KEY = "test-api-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe("sendEmail", () => {
  it("resolves without error when Resend returns 200", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await expect(
      sendEmail({ to: "user@example.com", subject: "Hello", html: "<p>body</p>" }),
    ).resolves.toBeUndefined();
  });

  it("throws with status code when Resend returns a non-2xx status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    });

    await expect(
      sendEmail({ to: "bad@example.com", subject: "fail", html: "<p>x</p>" }),
    ).rejects.toThrow("Resend API error 422");
  });

  it("skips the fetch call and does not throw when RESEND_API_KEY is absent", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      sendEmail({ to: "user@example.com", subject: "Hello", html: "<p>body</p>" }),
    ).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a POST to the Resend endpoint with correct Authorization header", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({ to: "user@example.com", subject: "Subj", html: "<p>hi</p>" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends the correct JSON body with to as an array", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({ to: "user@example.com", subject: "Subj", html: "<b>bold</b>" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("Subj");
    expect(body.html).toBe("<b>bold</b>");
  });

  it("uses the custom from address when provided in opts", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({
      to: "user@example.com",
      subject: "S",
      html: "<p>x</p>",
      from: "custom@myapp.com",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("custom@myapp.com");
  });

  it("falls back to EMAIL_FROM env when from is not provided in opts", async () => {
    process.env.EMAIL_FROM = "env-sender@example.com";
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({ to: "user@example.com", subject: "S", html: "<p>x</p>" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("env-sender@example.com");
  });

  it("uses the hardcoded default from address when neither opt nor env is set", async () => {
    delete process.env.EMAIL_FROM;
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({ to: "user@example.com", subject: "S", html: "<p>x</p>" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("WaterWatch DMV <alerts@watervoice.app>");
  });
});
