const TEMPLATE_NAMES: Record<string, string> = {
  restaurant: 'restaurant or food-service website',
  saas: 'software product or SaaS website',
  portfolio: 'personal or professional portfolio website',
};

const PALETTE_NAMES: Record<string, string> = {
  clay: 'warm terracotta and cream',
  green: 'sage green and cream',
  blue: 'slate blue',
  charcoal: 'warm charcoal',
};

export function composeWebsitePrompt(
  prompt: string,
  templateId: string,
  options: Record<string, unknown>,
): string {
  const template = TEMPLATE_NAMES[templateId] ?? TEMPLATE_NAMES.saas!;
  const palette = typeof options.palette === 'string'
    ? PALETTE_NAMES[options.palette] ?? 'warm terracotta and cream'
    : 'warm terracotta and cream';
  const menuBar = options.menuBar !== false;
  const testimonials = options.testimonials === true;
  const premiumHero = options.premiumHero === true;

  return [
    prompt,
    'D-GUY website settings selected by the user. Treat these selected settings as explicit requirements while preserving the content and functionality requested by the user:',
    `Website type: ${template}.`,
    `Visual theme: ${palette}.`,
    menuBar
      ? 'Include an accessible, responsive top navigation menu with a mobile menu toggle.'
      : 'Do not include a top navigation or menu bar. Keep the page content and footer navigation usable without one.',
    `Testimonials section: ${testimonials ? 'include it' : 'do not add one unless the user explicitly requests it'}.`,
    `Hero style: ${premiumHero ? 'premium and polished' : 'clear and appropriate to the website type'}.`,
    'Deliver one complete, responsive single-page website that satisfies all sections, content, and interactions requested by the user.',
  ].join('\n\n');
}
