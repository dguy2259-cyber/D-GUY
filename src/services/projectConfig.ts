import type { SiteOptions, TemplateId } from '@/types/project';
import type { PaletteId } from '@/theme/palettes';

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  restaurant: 'Restaurant',
  saas: 'Software product',
  portfolio: 'Portfolio',
};

export function selectTemplate(prompt: string): TemplateId {
  const text = prompt.toLowerCase();
  if (/restaurant|cafe|café|bistro|food|menu|dining|bakery|eatery|coffee|kitchen/.test(text)) return 'restaurant';
  if (/portfolio|personal|resume|cv\b|designer|photographer|developer|artist|freelanc|about me/.test(text)) return 'portfolio';
  return 'saas';
}

export function inferOptions(prompt: string): SiteOptions {
  const text = prompt.toLowerCase();
  const palette: PaletteId = /green|sage|forest|emerald|olive/.test(text) ? 'green'
    : /blue|navy|ocean|slate/.test(text) ? 'blue'
      : /charcoal|black|dark/.test(text) ? 'charcoal' : 'clay';
  const menuBar = !/\b(?:no|without|hide|remove|disable|omit)\s+(?:a\s+)?(?:top\s+)?(?:menu|navigation|nav)(?:\s+bar)?\b/.test(text);
  return { palette, testimonials: /testimonial|reviews?\b/.test(text), premiumHero: /premium|luxury|elegant/.test(text), menuBar };
}
