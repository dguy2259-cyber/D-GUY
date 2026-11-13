import { describe, expect, it, vi } from 'vitest';
import { failInterruptedGenerations } from './recovery.js';

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
});
