import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requestValidationFields, requestValidationMessage } from './requestValidation.js';

describe('public request validation diagnostics', () => {
  it('identifies invalid field names without echoing submitted values', () => {
    const result = z.object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse({ email: 'private-invalid-value', password: 'secret' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fields = requestValidationFields(result.error);
    expect(fields).toEqual(['email']);
    expect(requestValidationMessage(fields)).toBe('Request validation failed for: email.');
    expect(requestValidationMessage(fields)).not.toContain('private-invalid-value');
    expect(requestValidationMessage(fields)).not.toContain('secret');
  });

  it('uses a bounded generic message when a schema issue has no field path', () => {
    const result = z.string().safeParse({ password: 'secret' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(requestValidationFields(result.error)).toEqual([]);
    expect(requestValidationMessage([])).toBe('Request validation failed. Check the request fields.');
  });
});
