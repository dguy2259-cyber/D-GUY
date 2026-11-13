import type { PaletteId } from '@/theme/palettes';

export type TemplateId = 'restaurant' | 'saas' | 'portfolio';

export type ViewportMode = 'desktop' | 'tablet' | 'mobile';

export type PreviewStatus = 'ready' | 'generating' | 'preview-ready' | 'error';

export interface SiteOptions {
  palette: PaletteId;
  testimonials: boolean;
  premiumHero: boolean;
}

export interface RequirementOverrides {
  templateId: TemplateId | null;
  palette: PaletteId | null;
  testimonials: boolean | null;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface SiteVersion {
  id: string;
  number: number;
  prompt: string;
  summary: string;
  templateId: TemplateId;
  options: SiteOptions;
  files: ProjectFile[];
  createdAt: number;
  previewMode?: 'template' | 'static-files' | 'sandbox-html';
  warnings?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  messages: ChatMessage[];
  versions: SiteVersion[];
  activeVersionId: string | null;
  createdAt: number;
  updatedAt?: number;
}
