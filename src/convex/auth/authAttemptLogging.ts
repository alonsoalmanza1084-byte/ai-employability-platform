export function logDevAuthAttempt(provider: string): void {
  if (process.env.AUTH_DEBUG !== "1") return;

  console.info("AUTH_ATTEMPT", { provider, ts: Date.now() });
}