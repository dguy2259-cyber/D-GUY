import { describe, expect, it } from 'vitest';
import { buildWebContainerFileTree, detectWebContainerProject } from '../../../src/services/webcontainerFiles.ts';

describe('WebContainer project preparation', () => {
  it('mounts validated nested project paths as regular files', () => {
    expect(buildWebContainerFileTree([
      { path: 'package.json', content: '{"name":"site"}' },
      { path: 'src/pages/index.tsx', content: 'export default function Page() {}' },
    ])).toEqual({
      'package.json': { file: { contents: '{"name":"site"}' } },
      src: { directory: { pages: { directory: { 'index.tsx': { file: { contents: 'export default function Page() {}' } } } } } },
    });
  });

  it('runs only recognized React tooling with an explicit start script', () => {
    expect(detectWebContainerProject([{ path: 'package.json', content: JSON.stringify({ dependencies: { react: '^18', vite: '^7' }, scripts: { dev: 'vite' } }) }])).toBe('vite');
    expect(detectWebContainerProject([{ path: 'package.json', content: JSON.stringify({ dependencies: { next: '^15', react: '^18' }, scripts: { dev: 'next dev' } }) }])).toBe('next');
    expect(detectWebContainerProject([{ path: 'package.json', content: JSON.stringify({ dependencies: { react: '^18' }, scripts: { dev: 'unknown-runner' } }) }])).toBeNull();
  });

  it('rejects unsafe relative paths and file/directory collisions', () => {
    expect(() => buildWebContainerFileTree([{ path: '../outside.js', content: 'unsafe' }])).toThrow('unsafe file path');
    expect(() => buildWebContainerFileTree([{ path: 'src', content: 'a' }, { path: 'src/main.tsx', content: 'b' }])).toThrow('file/directory path conflict');
  });
});
