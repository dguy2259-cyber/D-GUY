import { describe, expect, it, vi } from 'vitest';
import { runAutomaticCorrectionLoop } from './automaticCorrection.js';

describe('automatic generated-code correction loop', () => {
  it('leaves the successful path untouched', async () => {
    const correct = vi.fn();
    const validate = vi.fn();
    await expect(runAutomaticCorrectionLoop({ validate, identify: () => undefined, correct })).resolves.toBe(0);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(correct).not.toHaveBeenCalled();
  });

  it('feeds validation defects back into a bounded repair callback until validation passes', async () => {
    let valid = false;
    const correct = vi.fn(async () => { valid = true; });
    const issue = { code: 'javascript_syntax_error', filePath: 'app.js' };
    const onCorrection = vi.fn();
    await expect(runAutomaticCorrectionLoop({
      validate: () => { if (!valid) throw new Error('syntax'); },
      identify: () => issue,
      correct,
      onCorrection,
    })).resolves.toBe(1);
    expect(correct).toHaveBeenCalledWith(issue, 1, 1);
    expect(onCorrection).toHaveBeenCalledWith(issue, 1, 1);
  });

  it('permits a second targeted repair of the same file and then stops at its bound', async () => {
    const correct = vi.fn();
    await expect(runAutomaticCorrectionLoop({
      maxCorrections: 5,
      maxCorrectionsPerFile: 2,
      validate: () => { throw new Error('still invalid'); },
      identify: () => ({ code: 'responsive_navigation_missing', filePath: 'index.html' }),
      correct,
    })).rejects.toThrow('still invalid');
    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct).toHaveBeenNthCalledWith(1, { code: 'responsive_navigation_missing', filePath: 'index.html' }, 1, 1);
    expect(correct).toHaveBeenNthCalledWith(2, { code: 'responsive_navigation_missing', filePath: 'index.html' }, 2, 2);
  });

  it('does not retry unsafe or unrecognized failures', async () => {
    const failure = new Error('database error');
    const correct = vi.fn();
    await expect(runAutomaticCorrectionLoop({
      validate: () => { throw failure; },
      identify: () => undefined,
      correct,
    })).rejects.toBe(failure);
    expect(correct).not.toHaveBeenCalled();
  });
});
