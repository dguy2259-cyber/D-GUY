export type PaletteId = 'clay' | 'green' | 'blue' | 'charcoal';

export interface SiteTheme {
  name: string;
  background: string;
  surface: string;
  accent: string;
  accentStrong: string;
  highlight: string;
  text: string;
  muted: string;
  inverse: string;
}

export const palettes: Record<PaletteId, SiteTheme> = {
  clay: {
    name: 'Terracotta Clay',
    background: '#FFFCF6',
    surface: '#F7F3EB',
    accent: '#B86F5B',
    accentStrong: '#945441',
    highlight: '#E8B8A5',
    text: '#302B29',
    muted: '#6B635C',
    inverse: '#302B29',
  },
  green: {
    name: 'Sage and Cream',
    background: '#FBF8EE',
    surface: '#F1F4E6',
    accent: '#4E8A5E',
    accentStrong: '#2F6B43',
    highlight: '#CFE3C2',
    text: '#1E2B22',
    muted: '#5E6B61',
    inverse: '#1E2B22',
  },
  blue: {
    name: 'Slate Blue',
    background: '#F6F8FB',
    surface: '#E9EFF6',
    accent: '#5A7FA3',
    accentStrong: '#3D5F82',
    highlight: '#BFD2E6',
    text: '#1B2A3A',
    muted: '#5A6878',
    inverse: '#1B2A3A',
  },
  charcoal: {
    name: 'Warm Charcoal',
    background: '#F7F3EB',
    surface: '#EDE5D8',
    accent: '#4A4442',
    accentStrong: '#302B29',
    highlight: '#E8B8A5',
    text: '#302B29',
    muted: '#6B635C',
    inverse: '#302B29',
  },
};
