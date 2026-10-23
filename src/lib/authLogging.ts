type AuthLogError = {
  provider: string;
  message: string;
  code?: string;
};

const SENSITIVE_HEADER =
  /((?:authorization|cookie|set-cookie|x-api-key)\s*:\s*)[^\r\n]*/gi;
const SENSITIVE_ASSIGNMENT =
  /((?:access[_ -]?token|refresh[_ -]?token|token|otp|code|authorization|cookie|set-cookie|x-api-key|api[_ -]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function sanitizeAuthLogValue(value: string): string {
  return value
    .replace(SENSITIVE_HEADER, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 300);
}

export function logAuthError({ provider, message, code }: AuthLogError): void {
  if (!import.meta.env.DEV) return;

  console.error("[auth] sign-in failed", {
    provider: sanitizeAuthLogValue(provider),
    message: sanitizeAuthLogValue(message),
    code: code === undefined ? undefined : sanitizeAuthLogValue(code),
  });
}