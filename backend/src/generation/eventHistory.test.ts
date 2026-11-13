import { describe, expect, it } from 'vitest';
import { GenerationEventHistory } from './eventHistory.js';

describe('generation SSE event replay', () => {
  it('replays staged provider and file events in order for a late subscriber', () => {
    const history = new GenerationEventHistory();
    history.append('job-1', 'stage', { id: 'generating' }, 100);
    history.append('job-1', 'file_delta', { path: 'index.html', text: '<main>' }, 101);
    expect(history.read('job-1', 102)).toEqual([
      { id: 1, event: 'stage', data: { id: 'generating' } },
      { id: 2, event: 'file_delta', data: { path: 'index.html', text: '<main>' } },
    ]);
    expect(history.readAfter('job-1', 1, 102)).toEqual([{ id: 2, event: 'file_delta', data: { path: 'index.html', text: '<main>' } }]);
  });

  it('bounds retained jobs, per-job bytes, and history age', () => {
    const history = new GenerationEventHistory(2, 48, 100);
    history.append('old', 'delta', { text: 'stale' }, 0);
    history.append('large', 'delta', { text: 'x'.repeat(64) }, 10);
    history.append('large', 'stage', { id: 'last' }, 11);
    history.append('newest', 'status', { status: 'running' }, 12);
    expect(history.read('old', 13)).toEqual([]);
    expect(history.read('large', 13)).toHaveLength(1);
    expect(history.read('newest', 200)).toEqual([]);
  });
});
