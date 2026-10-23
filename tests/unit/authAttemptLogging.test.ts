import { afterEach, describe, expect, it, vi } from "vitest";
import { logDevAuthAttempt } from "../../src/convex/auth/authAttemptLogging";

describe("logDevAuthAttempt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not log unless AUTH_DEBUG is exactly 1", () => {
    vi.stubEnv("AUTH_DEBUG", "0");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    logDevAuthAttempt("anonymous");

    expect(log).not.toHaveBeenCalled();
  });

  it("logs only provider and timestamp when AUTH_DEBUG is 1", () => {
    vi.stubEnv("AUTH_DEBUG", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    logDevAuthAttempt("anonymous");

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("AUTH_ATTEMPT", {
      provider: "anonymous",
      ts: expect.any(Number),
    });
  });
});