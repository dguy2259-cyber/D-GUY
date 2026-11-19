import { projectFilesSchema } from '../security/files.js';

export function createPartialFileSnapshot(
  contextFiles: unknown,
  partialFiles: ReadonlyMap<string, string>,
): Array<{ path: string; content: string }> | undefined {
  const changedFiles = [...partialFiles.entries()].filter(([, content]) => content.length > 0);
  if (!changedFiles.length) return undefined;

  const filesByPath = new Map<string, string>();
  if (Array.isArray(contextFiles)) {
    for (const file of contextFiles) {
      if (file && typeof file === 'object' && 'path' in file && 'content' in file &&
        typeof file.path === 'string' && typeof file.content === 'string') {
        filesByPath.set(file.path, file.content);
      }
    }
  }
  for (const [path, content] of changedFiles) filesByPath.set(path, content);

  const parsed = projectFilesSchema.safeParse(
    [...filesByPath.entries()].map(([path, content]) => ({ path, content })),
  );
  return parsed.success ? parsed.data : undefined;
}
