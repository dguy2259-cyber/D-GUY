import type { ProjectFile, SiteOptions, SiteVersion, TemplateId } from '../types/project';

export interface UnsavedPreviewInput {
  jobId: string;
  prompt: string;
  summary: string;
  templateId: TemplateId;
  options: SiteOptions;
  number: number;
  files: ProjectFile[];
  warnings: string[];
  createdAt?: number;
}

export function createUnsavedPreviewVersion(input: UnsavedPreviewInput): SiteVersion | null {
  if (!input.files.some((file) => file.path.toLowerCase() === 'index.html' && file.content.trim())) return null;
  return {
    id: `draft-${input.jobId}`,
    number: input.number,
    prompt: input.prompt,
    summary: input.summary,
    templateId: input.templateId,
    options: input.options,
    files: input.files,
    createdAt: input.createdAt ?? Date.now(),
    previewMode: 'sandbox-html',
    warnings: input.warnings,
  };
}
