import { describe, expect, it } from 'vitest';
import { buildGenerationPrompt } from './buildPrompt.js';

describe('generation prompt settings', () => {
  it('passes the selected website type, theme, navigation, and section controls to the model', () => {
    const prompt = buildGenerationPrompt(
      'Create a premium launch page with pricing and contact details.',
      'saas',
      { palette: 'blue', navigation: false, testimonials: true },
    );

    expect(prompt).toContain('type=saas');
    expect(prompt).toContain('visual theme=slate blue');
    expect(prompt).toContain('do not include a top navigation bar or menu');
    expect(prompt).toContain('include a testimonials section');
    expect(prompt).toContain('pricing and contact details');
  });

  it('defaults legacy navigation settings to enabled and safely handles unknown themes', () => {
    const prompt = buildGenerationPrompt('Build a website.', 'portfolio', { palette: 'unknown' });
    expect(prompt).toContain('type=portfolio');
    expect(prompt).toContain('include an accessible responsive menu bar');
    expect(prompt).toContain('choose a polished theme matching the request');
  });
});
