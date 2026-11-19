import { describe, expect, it, vi } from 'vitest';
import { failInterruptedGenerations, failOrphanedGeneration } from './recovery.js';

describe('generation process-restart recovery', () => {
  it('fails only queued/running jobs created before this process started', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const store = { generationJob: { updateMany } };
    const startedAt = new Date('2026-11-09T10:00:00.000Z');
    const finishedAt = new Date('2026-11-09T10:00:01.000Z');
    await expect(failInterruptedGenerations(store, startedAt, finishedAt)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['queued', 'running'] }, createdAt: { lt: startedAt } },
      data: { status: 'failed', errorCode: 'PROCESS_RESTARTED', finishedAt },
    });
  });

  it('fails a running job when its in-memory worker no longer exists', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = { generationJob: { updateMany } };
    const finishedAt = new Date('2026-11-09T10:00:01.000Z');
    await expect(failOrphanedGeneration(store, 'job-1', finishedAt)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'running' },
      data: { status: 'failed', errorCode: 'PROCESS_RESTARTED', finishedAt },
    });
  });
});
