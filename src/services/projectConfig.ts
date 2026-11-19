import type { SiteOptions, TemplateId } from '@/types/project';
import type { PaletteId } from '@/theme/palettes';

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  restaurant: 'Restaurant',
  saas: 'Software product',
  portfolio: 'Portfolio',
};

export function selectTemplate(prompt: string): TemplateId {
  const text = prompt.toLowerCase();
  if (/restaurant|cafe|café|bistro|food|dining|bakery|eatery|coffee|kitchen/.test(text)) return 'restaurant';
  if (/portfolio|personal|resume|cv\b|designer|photographer|developer|artist|freelanc|about me/.test(text)) return 'portfolio';
  return 'saas';
}

export function inferOptions(prompt: string): SiteOptions {
  const text = prompt.toLowerCase();
  const palette: PaletteId = /green|sage|forest|emerald|olive/.test(text) ? 'green'
    : /blue|navy|ocean|slate/.test(text) ? 'blue'
      : /charcoal|black|dark/.test(text) ? 'charcoal' : 'clay';
  return {
    palette,
    testimonials: /testimonial|reviews?\b/.test(text),
    premiumHero: /premium|luxury|elegant/.test(text),
    navigation: !/\b(?:no|without|remove|hide|don't include|do not include)\s+(?:(?:the|a)\s+)?(?:top\s+)?(?:menu|navigation(?:\s+bar)?|nav(?:\s+bar)?|navbar)\b/.test(text),
  };
}
