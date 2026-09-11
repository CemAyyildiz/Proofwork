import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/config/env";
import { AppError } from "./errors";

type Limiter = { limit: (key: string) => Promise<{ success: boolean }> };

function makeLimiter(requests: number, windowSeconds: number): Limiter {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
    return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`), prefix: "pw" });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Upstash rate limiting is required in production (UPSTASH_REDIS_REST_URL / _TOKEN)");
  }
  // Development fallback only.
  const hits = new Map<string, number[]>();
  return {
    async limit(key) {
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      recent.push(now);
      hits.set(key, recent);
      return { success: recent.length <= requests };
    },
  };
}

const cache: Partial<Record<"auth" | "submit" | "appeal", Limiter>> = {};
/** Limiters are created on first use so importing this module never touches the environment. */
export const limiters = {
  get auth(): Limiter {
    return (cache.auth ??= makeLimiter(10, 600));
  },
  get submit(): Limiter {
    return (cache.submit ??= makeLimiter(5, 600));
  },
  get appeal(): Limiter {
    return (cache.appeal ??= makeLimiter(3, 3600));
  },
};

export async function enforce(limiter: Limiter, key: string): Promise<void> {
  const { success } = await limiter.limit(key);
  if (!success) throw new AppError("RATE_LIMITED", "too many requests");
}
