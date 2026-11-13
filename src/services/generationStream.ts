export interface GenerationStreamEvent { event: string; data: Record<string, unknown> }

class TerminalGenerationError extends Error {}

function parseFrame(frame: string): { id?: string; event?: string; data?: string } {
  const values: { id?: string; event?: string; data?: string } = {};
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = (separator < 0 ? '' : line.slice(separator + 1)).replace(/^ /, '');
    if (field === 'id' && !value.includes('\0')) values.id = value;
    else if (field === 'event') values.event = value;
    else if (field === 'data') values.data = values.data ? `${values.data}\n${value}` : value;
  }
  return values;
}

/** Reads generation SSE and resumes from the last received event cursor after transient disconnects. */
export async function consumeGenerationStream(
  connect: (lastEventId?: string) => Promise<Response>,
  signal: AbortSignal,
  onEvent: (event: GenerationStreamEvent) => void,
  maxReconnects = 2,
): Promise<void> {
  let lastEventId: string | undefined;
  let reconnects = 0;
  let terminal = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  while (!terminal) {
    try {
      const response = await connect(lastEventId);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
        const message = typeof payload.error?.message === 'string' ? payload.error.message : `Generation stream failed (${response.status})`;
        if (response.status < 500) throw new TerminalGenerationError(message);
        throw new Error(message);
      }
      activeReader = response.body?.getReader();
      if (!activeReader) throw new Error('Generation stream is unavailable.');
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (frame: string) => {
        const parsedFrame = parseFrame(frame);
        if (!parsedFrame.event || parsedFrame.data === undefined) return;
        if (parsedFrame.id && /^\d{1,12}$/.test(parsedFrame.id)) lastEventId = parsedFrame.id;
        let data: Record<string, unknown>;
        try { data = JSON.parse(parsedFrame.data) as Record<string, unknown>; }
        catch { throw new Error('Generation stream returned malformed event data.'); }
        onEvent({ event: parsedFrame.event, data });
        if (parsedFrame.event === 'complete' || (parsedFrame.event === 'status' && data.status === 'complete')) terminal = true;
        const message = typeof data.error === 'string' ? data.error : 'AI generation did not complete. The previous version remains available.';
        if ((parsedFrame.event === 'status' && data.status === 'failed') || parsedFrame.event === 'failed') throw new TerminalGenerationError(message);
        if ((parsedFrame.event === 'status' && data.status === 'cancelled') || parsedFrame.event === 'cancelled') throw new TerminalGenerationError(typeof data.error === 'string' ? data.error : 'Generation was cancelled.');
      };
      while (!terminal) {
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const part = await activeReader.read();
        buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) consume(frame);
        if (part.done) {
          if (buffer.trim()) consume(buffer);
          if (!terminal) throw new Error('Generation stream ended before completion.');
        }
      }
      await activeReader.cancel().catch(() => undefined);
      activeReader = undefined;
    } catch (error) {
      await activeReader?.cancel().catch(() => undefined);
      activeReader = undefined;
      if (error instanceof TerminalGenerationError) throw error;
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      if (reconnects >= maxReconnects) throw error;
      reconnects++;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 250 * reconnects);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    }
  }
}
