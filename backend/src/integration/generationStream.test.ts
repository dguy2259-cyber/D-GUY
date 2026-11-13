import { describe, expect, it, vi } from 'vitest';
import { consumeGenerationStream } from '../../../src/services/generationStream.ts';

function eventStream(...frames: string[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('resumable generation event stream', () => {
  it('reconnects from the last event id and completes without replaying earlier deltas', async () => {
    const signal = new AbortController().signal;
    const connect = vi.fn()
      .mockResolvedValueOnce(eventStream('id: 7\nevent: file_delta\ndata: {"path":"index.html","text":"<main>"}\n\n'))
      .mockImplementationOnce(async (lastId?: string) => {
        expect(lastId).toBe('7');
        return eventStream('id: 8\nevent: complete\ndata: {"status":"complete"}\n\n');
      });
    const received: string[] = [];
    await consumeGenerationStream(connect, signal, ({ event }) => received.push(event));
    expect(connect).toHaveBeenCalledTimes(2);
    expect(received).toEqual(['file_delta', 'complete']);
  });

  it('does not retry terminal generation failures', async () => {
    const connect = vi.fn().mockResolvedValue(eventStream('event: failed\ndata: {"error":"provider failed"}\n\n'));
    await expect(consumeGenerationStream(connect, new AbortController().signal, () => undefined)).rejects.toThrow('provider failed');
    expect(connect).toHaveBeenCalledOnce();
  });
});
