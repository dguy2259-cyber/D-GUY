import type { FileSystemTree } from '@webcontainer/api';
import type { ProjectFile } from '@/types/project';

export function buildWebContainerFileTree(files: ProjectFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const { path, content } of files) {
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) throw new Error('The project contains an unsafe file path.');
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const node = directory[segment];
      if (node && !('directory' in node)) throw new Error('The project has a file/directory path conflict.');
      if (!node) directory[segment] = { directory: {} };
      directory = (directory[segment] as { directory: FileSystemTree }).directory;
    }
    const filename = segments[segments.length - 1]!;
    if (directory[filename]) throw new Error('The project contains duplicate file paths.');
    directory[filename] = { file: { contents: content } };
  }
  return root;
}

export function detectWebContainerProject(files: ProjectFile[]): 'vite' | 'next' | 'react-scripts' | null {
  const manifest = files.find((file) => file.path === 'package.json');
  if (!manifest) return null;
  try {
    const pkg = JSON.parse(manifest.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!deps.react && !deps.next) return null;
    if (deps.next && pkg.scripts?.dev) return 'next';
    if (deps.vite && pkg.scripts?.dev) return 'vite';
    if (deps['react-scripts'] && pkg.scripts?.start) return 'react-scripts';
    return null;
  } catch { return null; }
}
