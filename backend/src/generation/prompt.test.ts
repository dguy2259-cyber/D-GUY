import { describe, expect, it } from 'vitest';
import { composeWebsitePrompt } from './prompt.js';
import { inferOptions, selectTemplate } from '../../../src/services/projectConfig.js';

describe('website generation options', () => {
  it('restores useful auto-detected defaults for type, theme, and menu visibility', () => {
    expect(selectTemplate('Create a restaurant website')).toBe('restaurant');
    expect(inferOptions('Build a dark portfolio website')).toMatchObject({ palette: 'charcoal', menuBar: true });
    expect(inferOptions('Create a site without a menu bar')).toMatchObject({ menuBar: false });
  });

  it('carries the selected type, theme, and menu-bar choice into the AI prompt', () => {
    const prompt = composeWebsitePrompt(
      'Build a premium site for my studio.',
      'portfolio',
      { palette: 'charcoal', menuBar: false, testimonials: true, premiumHero: true },
    );
    expect(prompt).toContain('personal or professional portfolio website');
    expect(prompt).toContain('warm charcoal');
    expect(prompt).toContain('Do not include a top navigation or menu bar.');
    expect(prompt).toContain('Testimonials section: include it.');
    expect(prompt).toContain('Hero style: premium and polished.');
    expect(prompt).toContain('Build a premium site for my studio.');
  });

  it('uses safe defaults for missing or invalid UI options', () => {
    const prompt = composeWebsitePrompt('Create a site.', 'unknown', { palette: 'not-a-theme' });
    expect(prompt).toContain('software product or SaaS website');
    expect(prompt).toContain('warm terracotta and cream');
    expect(prompt).toContain('Include an accessible, responsive top navigation menu');
  });
});
