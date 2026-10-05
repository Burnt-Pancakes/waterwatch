import { describe, it, expect } from "vitest";
import { validatePassword, isStrongPassword, emailSchema } from "./passwordValidation";

describe("validatePassword", () => {
  it("rejects short passwords", () => {
    expect(validatePassword("Ab1")).toMatch(/8 characters/);
  });
  it("rejects passwords without uppercase", () => {
    expect(validatePassword("password1")).toMatch(/uppercase/);
  });
  it("rejects passwords without a digit", () => {
    expect(validatePassword("Password")).toMatch(/number/);
  });
  it("rejects non-strings", () => {
    expect(validatePassword(undefined)).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
  });
  it("accepts a compliant password", () => {
    expect(validatePassword("Password1")).toBeNull();
    expect(isStrongPassword("Str0ngPass")).toBe(true);
  });
});

describe("emailSchema", () => {
  it("lowercases and trims", () => {
    expect(emailSchema.parse("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("rejects invalid", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
});
