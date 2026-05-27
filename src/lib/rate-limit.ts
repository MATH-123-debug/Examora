const ipRequestMap = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_STUDY_REQUESTS = 15;
const MAX_PDF_REQUESTS = 10;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export function checkRateLimit(
  request: Request,
  limit: number,
): { allowed: boolean; retryAfter: number } {
  const ip = getClientIp(request);
  const key = `${ip}`;
  const now = Date.now();
  const entry = ipRequestMap.get(key);

  if (!entry || now > entry.resetAt) {
    ipRequestMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export { MAX_STUDY_REQUESTS, MAX_PDF_REQUESTS };
