export class SandboxProcessTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The isolated project process did not finish within ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = 'SandboxProcessTimeoutError';
  }
}

/** Memoizes an async singleton while allowing a transient boot failure to be retried. */
export function retryableLazy<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const attempt = factory();
      pending = attempt.catch((error) => {
        if (pending === attempt || pending === wrapped) pending = undefined;
        throw error;
      });
      const wrapped = pending;
    }
    return pending;
  };
}

/** Releases browser-sandbox preview listeners and its active process. */
export function disposeSandboxProcess(process?: { kill(): void }, cleanup?: () => void): void {
  cleanup?.();
  process?.kill();
}

/** Wait for a process in the browser sandbox without leaving preview setup stuck forever. */
export async function waitForSandboxProcess(
  exit: Promise<number>,
  timeoutMs: number,
  kill: () => void,
): Promise<number> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError('timeoutMs must be a positive finite number');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try { kill(); } finally { reject(new SandboxProcessTimeoutError(timeoutMs)); }
    }, timeoutMs);
  });

  try {
    return await Promise.race([exit, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
