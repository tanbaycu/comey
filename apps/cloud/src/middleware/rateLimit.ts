import type { Context } from 'hono';
import type { AppContextEnv } from '../env.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitRow {
  hits: number;
  reset_at: string;
}

interface LocalBucket {
  hits: number;
  resetAtMs: number;
}

const d1PreFilterCache = new WeakMap<D1Database, Map<string, LocalBucket>>();
const localRateLimitCache = new WeakMap<D1Database, Map<string, LocalBucket>>();
const MAX_LOCAL_BUCKETS = 5000;

function getBucketMap(
  store: WeakMap<D1Database, Map<string, LocalBucket>>,
  db: D1Database
): Map<string, LocalBucket> {
  let map = store.get(db);
  if (!map) {
    map = new Map<string, LocalBucket>();
    store.set(db, map);
  }
  return map;
}

function pruneExpiredIfNeeded(map: Map<string, LocalBucket>, nowMs: number): void {
  if (map.size < MAX_LOCAL_BUCKETS) return;
  for (const [key, entry] of map.entries()) {
    if (entry.resetAtMs <= nowMs) {
      map.delete(key);
    }
  }
  if (map.size >= MAX_LOCAL_BUCKETS) {
    map.clear();
  }
}

export function getClientIp(c: Context<AppContextEnv>): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const xRealIp = c.req.header('x-real-ip');
  if (xRealIp && xRealIp.trim()) return xRealIp.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return 'local';
}

/**
 * Zero-D1-write isolate-local sliding window rate limiter keyed per D1Database instance
 * (so isolated test databases never pollute each other).
 */
export function checkLocalRateLimit(
  db: D1Database,
  bucketKey: string,
  maxHits: number,
  windowMs: number,
  nowMs: number = Date.now()
): RateLimitResult {
  const map = getBucketMap(localRateLimitCache, db);
  pruneExpiredIfNeeded(map, nowMs);

  const existing = map.get(bucketKey);
  if (!existing || existing.resetAtMs <= nowMs) {
    const resetAtMs = nowMs + windowMs;
    map.set(bucketKey, { hits: 1, resetAtMs });
    return {
      allowed: true,
      remaining: Math.max(0, maxHits - 1),
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  existing.hits += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
  if (existing.hits > maxHits) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxHits - existing.hits),
    retryAfterSeconds,
  };
}

/**
 * Distributed atomic D1 rate limiter fronted by an isolate-local RAM pre-filter:
 * once an active window has already exceeded maxHits on this isolate, repeated
 * burst requests are rejected in RAM with ZERO extra D1 writes.
 */
export async function checkRateLimit(
  db: D1Database,
  bucketKey: string,
  maxHits: number,
  windowSeconds: number,
  nowMs: number = Date.now()
): Promise<RateLimitResult> {
  const cache = getBucketMap(d1PreFilterCache, db);
  pruneExpiredIfNeeded(cache, nowMs);

  const cached = cache.get(bucketKey);
  if (cached && cached.resetAtMs > nowMs && cached.hits >= maxHits) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((cached.resetAtMs - nowMs) / 1000)),
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const resetIso = new Date(nowMs + windowSeconds * 1000).toISOString();

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket_key, hits, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`
    )
    .bind(bucketKey, resetIso, nowIso, nowIso)
    .first<RateLimitRow>();

  const hits = Number(row?.hits ?? 1);
  const resetAtMs = row?.reset_at ? Date.parse(row.reset_at) : nowMs + windowSeconds * 1000;
  cache.set(bucketKey, { hits, resetAtMs });

  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

  if (hits > maxHits) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxHits - hits),
    retryAfterSeconds,
  };
}
