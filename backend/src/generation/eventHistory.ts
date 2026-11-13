export interface GenerationFrame { id: number; event: string; data: unknown }

interface HistoryEntry { frames: GenerationFrame[]; bytes: number; updatedAt: number; nextId: number }

/** Bounded process-local replay for SSE subscribers that attach after a job starts. */
export class GenerationEventHistory {
  private readonly entries = new Map<string, HistoryEntry>();

  constructor(
    private readonly maxJobs = 24,
    private readonly maxBytesPerJob = 4 * 1024 * 1024,
    private readonly retentionMs = 2 * 60_000,
  ) {}

  append(jobId: string, event: string, data: unknown, now = Date.now()): number {
    this.sweep(now);
    let entry = this.entries.get(jobId);
    if (!entry) {
      entry = { frames: [], bytes: 0, updatedAt: now, nextId: 1 };
      this.entries.set(jobId, entry);
    }
    const id = entry.nextId++;
    const bytes = Buffer.byteLength(JSON.stringify({ event, data }), 'utf8');
    entry.frames.push({ id, event, data });
    entry.bytes += bytes;
    entry.updatedAt = now;
    while (entry.bytes > this.maxBytesPerJob && entry.frames.length > 1) {
      const removed = entry.frames.shift()!;
      entry.bytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8');
    }
    while (this.entries.size > this.maxJobs) this.entries.delete(this.entries.keys().next().value!);
    return id;
  }

  read(jobId: string, now = Date.now()): GenerationFrame[] {
    this.sweep(now);
    const entry = this.entries.get(jobId);
    if (!entry) return [];
    entry.updatedAt = now;
    return entry.frames.map(({ id, event, data }) => ({ id, event, data }));
  }

  readAfter(jobId: string, cursor: number, now = Date.now()): GenerationFrame[] {
    return this.read(jobId, now).filter((frame) => frame.id > cursor);
  }

  private sweep(now: number): void {
    for (const [id, entry] of this.entries) if (now - entry.updatedAt > this.retentionMs) this.entries.delete(id);
  }
}
