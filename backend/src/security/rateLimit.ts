import { createHmac } from 'node:crypto';

export interface RateLimitPool {
  query(sql: string, values: unknown[]): Promise<{ rows: Array<{ hits: number; retryAfterSeconds: number | string }> }>;
}

export function rateLimitBucketKey(scope: string, clientAddress: string, secret: string): string {
  return createHmac('sha256', secret).update(`${scope}\0${clientAddress}`).digest('hex');
}

/** Atomic fixed-window counter shared by all API instances through PostgreSQL. */
export async function consumeDistributedRateLimit(pool: RateLimitPool, key: string, limit: number, windowMs: number) {
  const result = await pool.query(
    `INSERT INTO "ApiRateLimitBucket" ("key", "hits", "resetAt")
     VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 millisecond'))
     ON CONFLICT ("key") DO UPDATE SET
       "hits" = CASE WHEN "ApiRateLimitBucket"."resetAt" <= NOW() THEN 1 ELSE "ApiRateLimitBucket"."hits" + 1 END,
       "resetAt" = CASE WHEN "ApiRateLimitBucket"."resetAt" <= NOW()
         THEN NOW() + ($2 * INTERVAL '1 millisecond') ELSE "ApiRateLimitBucket"."resetAt" END
     RETURNING "hits", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("resetAt" - NOW()))))::integer AS "retryAfterSeconds"`,
    [key, windowMs],
  );
  const row = result.rows[0];
  if (!row) throw new Error('rate_limit_query_returned_no_row');
  return { allowed: row.hits <= limit, retryAfterSeconds: Number(row.retryAfterSeconds), hits: row.hits };
}
