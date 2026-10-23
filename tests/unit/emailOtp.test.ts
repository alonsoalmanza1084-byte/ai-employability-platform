import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOtp } from "../../src/convex/auth/emailOtp";

describe("email OTP API key configuration", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_RESEND_KEY", undefined);
    vi.stubEnv("VLY_EMAIL_API_KEY", undefined);
    vi.spyOn(axios, "post").mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("accepts AUTH_RESEND_KEY by itself", async () => {
    vi.stubEnv("AUTH_RESEND_KEY", "test-key");

    await expect(
      emailOtp.sendVerificationRequest({ identifier: "user", token: "123456" }),
    ).resolves.toBeUndefined();
  });

  it("accepts VLY_EMAIL_API_KEY as a compatible fallback", async () => {
    vi.stubEnv("VLY_EMAIL_API_KEY", "test-key");

    await expect(
      emailOtp.sendVerificationRequest({ identifier: "user", token: "123456" }),
    ).resolves.toBeUndefined();
  });

  it("names both missing variables without exposing a value", async () => {
    await expect(
      emailOtp.sendVerificationRequest({ identifier: "user", token: "123456" }),
    ).rejects.toThrow(/AUTH_RESEND_KEY.*VLY_EMAIL_API_KEY/);
  });
});