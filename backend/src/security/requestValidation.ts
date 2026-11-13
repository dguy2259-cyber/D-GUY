import { z } from 'zod';

export function requestValidationFields(error: z.ZodError): string[] {
  return [...new Set(error.issues
    .map((issue) => issue.path.map(String).join('.'))
    .filter(Boolean))]
    .slice(0, 8);
}

export function requestValidationMessage(fields: readonly string[]): string {
  return fields.length
    ? `Request validation failed for: ${fields.join(', ')}.`
    : 'Request validation failed. Check the request fields.';
}
