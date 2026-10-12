/** Runs `worker` over `items` with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

/** Memoises async calls by key, de-duplicating concurrent requests and dropping rejections. */
export class AsyncCache<V> {
  private readonly entries = new Map<string, Promise<V>>();

  get(key: string, load: () => Promise<V>): Promise<V> {
    let hit = this.entries.get(key);
    if (!hit) {
      hit = load().catch((e) => {
        this.entries.delete(key);
        throw e;
      });
      this.entries.set(key, hit);
    }
    return hit;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Retries on HTTP 429 / transient failures with exponential backoff (honours `retryAfterMs` on the error). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode;
      const retryable = status === 429 || status === 503 || status === 502 || status === undefined;
      if (!retryable || i === attempts - 1) break;
      const hinted = (e as { retryAfterMs?: number }).retryAfterMs;
      await new Promise((r) => setTimeout(r, hinted ?? baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}
