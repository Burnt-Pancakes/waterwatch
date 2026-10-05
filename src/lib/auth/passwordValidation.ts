import { z } from "zod";

/**
 * Password policy for WaterVoice DMV.
 *
 * Rules (validated client- AND server-side):
 *  - min 8 characters
 *  - at least one uppercase letter
 *  - at least one digit
 *
 * WHY a single source: the same Zod schema is imported by the sign-up
 * form (instant feedback) and the `signUpUser` server function (trusted
 * gate). Drift between the two would let a weak password slip through
 * the server check.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[0-9]/, "Password must include at least one number");

/** Returns the first failing message, or null when valid. */
export function validatePassword(input: unknown): string | null {
  const result = passwordSchema.safeParse(input);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "Invalid password";
}

/** Convenience boolean wrapper. */
export function isStrongPassword(input: unknown): boolean {
  return validatePassword(input) === null;
}

/** Email schema reused by every auth surface. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(255, "Email is too long");
