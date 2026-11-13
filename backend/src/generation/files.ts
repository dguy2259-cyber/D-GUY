import { projectFilesSchema } from '../security/files.js';

export function assertPreviewEntrypoint(input: unknown) {
  const files = projectFilesSchema.parse(input);
  if (!files.some((file) => file.path.toLowerCase() === 'index.html' && file.content.trim().length > 0)) {
    throw new Error('Generated website must contain a non-empty index.html preview entry point.');
  }
  return files;
}

/** A revision overlays validated AI output onto the last saved project files. */
export function mergeGeneratedFiles(currentFiles: unknown, generatedFiles: unknown, mode: 'create' | 'revise') {
  const generated = projectFilesSchema.parse(generatedFiles);
  if (mode === 'create') return assertPreviewEntrypoint(generated);
  const previous = projectFilesSchema.parse(currentFiles);
  const merged = new Map(previous.map((file) => [file.path, file]));
  for (const file of generated) merged.set(file.path, file);
  return assertPreviewEntrypoint([...merged.values()]);
}
