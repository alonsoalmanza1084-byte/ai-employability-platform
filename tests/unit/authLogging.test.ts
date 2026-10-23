import { afterEach, describe, expect, it, vi } from "vitest";
import { logAuthError, sanitizeAuthLogValue } from "../../src/lib/authLogging";

describe("sanitizeAuthLogValue", () => {
  it("redacts bearer tokens, assigned secrets, auth headers, and email addresses", () => {
    const message = sanitizeAuthLogValue(
      "Bearer abc.def token=secret otp:123456\n" +
        "Authorization: Bearer xyz\n" +
        "Cookie: session=private; other=cookie-secret\nuser@example.test",
    );

    expect(message).toContain("Bearer [REDACTED]");
    expect(message).toContain("token=[REDACTED]");
    expect(message).toContain("otp:[REDACTED]");
    expect(message).toContain("Authorization: [REDACTED]");
    expect(message).toContain("Cookie: [REDACTED]");
    expect(message).toContain("[REDACTED_EMAIL]");
    expect(message).not.toContain("abc.def");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("123456");
    expect(message).not.toContain("xyz");
    expect(message).not.toContain("private");
    expect(message).not.toContain("cookie-secret");
    expect(message).not.toContain("user@example.test");
  });

  it("limits output to 300 characters", () => {
    expect(sanitizeAuthLogValue("x".repeat(500))).toHaveLength(300);
  });
});

describe("logAuthError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs sanitized details in development only", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    logAuthError({
      provider: "anonymous",
      message: "request failed for person@example.test token=secret",
      code: "AUTH_FAILED",
    });

    if (import.meta.env.DEV) {
      expect(log).toHaveBeenCalledOnce();
      const payload = JSON.stringify(log.mock.calls[0]);
      expect(payload).not.toContain("person@example.test");
      expect(payload).not.toContain("secret");
      expect(payload).toContain("[REDACTED_EMAIL]");
    } else {
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("does not log when development mode is disabled", () => {
    vi.stubEnv("DEV", false);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    logAuthError({ provider: "anonymous", message: "failure" });

    expect(log).not.toHaveBeenCalled();
  });
});