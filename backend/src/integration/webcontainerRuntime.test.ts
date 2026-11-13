import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeSandboxProcess, retryableLazy, SandboxProcessTimeoutError, waitForSandboxProcess } from '../../../src/services/webcontainerRuntime.ts';

afterEach(() => vi.useRealTimers());

describe('isolated WebContainer process lifecycle', () => {
  it('releases preview listeners and stops the sandbox process on teardown', () => {
    const kill = vi.fn();
    const cleanup = vi.fn();
    disposeSandboxProcess({ kill }, cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledOnce();
  });

  it('returns the process exit code and does not kill a completed process', async () => {
    const kill = vi.fn();
    await expect(waitForSandboxProcess(Promise.resolve(0), 1_000, kill)).resolves.toBe(0);
    expect(kill).not.toHaveBeenCalled();
  });

  it('kills a process that exceeds the dependency-install time limit', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const never = new Promise<number>(() => undefined);
    const result = waitForSandboxProcess(never, 60_000, kill);
    const rejected = expect(result).rejects.toBeInstanceOf(SandboxProcessTimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(kill).toHaveBeenCalledOnce();
  });

  it('does not leave a timer running after a process exits with an error', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    await expect(waitForSandboxProcess(Promise.resolve(1), 60_000, kill)).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(kill).not.toHaveBeenCalled();
  });

  it('shares concurrent runtime boot and caches a successful boot', async () => {
    let resolve!: (value: string) => void;
    const factory = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const getRuntime = retryableLazy(factory);
    const first = getRuntime();
    const second = getRuntime();
    expect(factory).toHaveBeenCalledOnce();
    resolve('runtime');
    await expect(Promise.all([first, second])).resolves.toEqual(['runtime', 'runtime']);
    await expect(getRuntime()).resolves.toBe('runtime');
    expect(factory).toHaveBeenCalledOnce();
  });

  it('retries runtime boot after a transient failure', async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error('boot unavailable')).mockResolvedValueOnce('runtime');
    const getRuntime = retryableLazy(factory);
    await expect(getRuntime()).rejects.toThrow('boot unavailable');
    await expect(getRuntime()).resolves.toBe('runtime');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
