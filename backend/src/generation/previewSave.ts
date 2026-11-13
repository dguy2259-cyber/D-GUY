export interface GeneratedPreview {
  summary: string;
  files: Array<{ path: string; content: string }>;
  warnings: string[];
}

export type PreviewPersistenceResult<T> =
  | { state: 'saved'; value: T; preview: GeneratedPreview }
  | { state: 'retrying'; error: unknown; preview: GeneratedPreview };

export async function persistOrKeepPreview<T>(
  persist: () => Promise<T>,
  preview: GeneratedPreview,
): Promise<PreviewPersistenceResult<T>> {
  try {
    return { state: 'saved', value: await persist(), preview };
  } catch (error) {
    return { state: 'retrying', error, preview };
  }
}
