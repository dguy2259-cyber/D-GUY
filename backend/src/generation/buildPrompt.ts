const PALETTE_DESCRIPTIONS: Record<string, string> = {
  clay: 'warm terracotta and cream',
  green: 'sage green and cream',
  blue: 'slate blue',
  charcoal: 'warm charcoal and cream',
};

export function buildGenerationPrompt(
  prompt: string,
  templateId: string,
  options: Record<string, unknown>,
): string {
  const palette = typeof options.palette === 'string' ? PALETTE_DESCRIPTIONS[options.palette] : undefined;
  const navigationEnabled = options.navigation !== false;
  const testimonialsEnabled = options.testimonials === true;
  return [
    prompt,
    `D-GUY website settings: type=${templateId}; visual theme=${palette ?? 'choose a polished theme matching the request'}; top navigation/menu=${navigationEnabled ? 'include an accessible responsive menu bar' : 'do not include a top navigation bar or menu'}; testimonials=${testimonialsEnabled ? 'include a testimonials section' : 'omit testimonials unless explicitly required in the user prompt'}.`,
    'Satisfy every concrete section, content, visual, responsive, and interaction requirement in the user prompt. Produce one cohesive, production-quality, single-page website. Keep interactions self-contained and ensure the preview works offline without server requests.',
  ].join('\n\n');
}
