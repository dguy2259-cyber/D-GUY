import { describe, expect, it } from 'vitest';
import { inferOptions, selectTemplate } from '../../../src/services/projectConfig.js';

describe('website defaults', () => {
  it('keeps auto-detected website type and theme from the prompt', () => {
    expect(selectTemplate('Build a personal designer portfolio')).toBe('portfolio');
    expect(inferOptions('Build a dark blue portfolio website')).toMatchObject({
      palette: 'blue',
      navigation: true,
    });
  });

  it('supports prompts that explicitly request no top menu', () => {
    expect(inferOptions('Create a landing page without a top navigation bar').navigation).toBe(false);
    expect(inferOptions('Create a landing page with no menu bar').navigation).toBe(false);
  });
});
