import { describe, expect, it } from 'vitest';
import { assertPreviewEntrypoint, mergeGeneratedFiles } from './files.js';

describe('revision file preservation', () => {
  it('overlays targeted changes and retains unchanged files', () => {
    const files = mergeGeneratedFiles([
      { path: 'index.html', content: '<main>old</main>' },
      { path: 'src/app.tsx', content: 'export const App = 1;' },
      { path: 'styles.css', content: 'body { color: black; }' },
    ], [{ path: 'index.html', content: '<main>updated</main>' }], 'revise');
    expect(files).toEqual([
      { path: 'index.html', content: '<main>updated</main>' },
      { path: 'src/app.tsx', content: 'export const App = 1;' },
      { path: 'styles.css', content: 'body { color: black; }' },
    ]);
  });

  it('validates merged output and validates new projects without prior context', () => {
    expect(mergeGeneratedFiles([], [{ path: 'index.html', content: 'hello' }], 'create')).toEqual([{ path: 'index.html', content: 'hello' }]);
    expect(() => mergeGeneratedFiles([{ path: '../secrets.txt', content: 'x' }], [{ path: 'index.html', content: 'ok' }], 'revise')).toThrow();
    expect(() => mergeGeneratedFiles([{ path: 'index.html', content: 'ok' }], [{ path: '../secrets.txt', content: 'x' }], 'revise')).toThrow();
  });

  it('requires a non-empty preview entry point for created and revised websites', () => {
    expect(() => assertPreviewEntrypoint([{ path: 'src/App.tsx', content: 'export default 1' }])).toThrow('index.html preview');
    expect(() => mergeGeneratedFiles([], [{ path: 'src/App.tsx', content: 'export default 1' }], 'create')).toThrow('index.html preview');
    expect(mergeGeneratedFiles([{ path: 'index.html', content: '<main>Saved preview</main>' }], [{ path: 'styles.css', content: 'body { color: cyan; }' }], 'revise')).toEqual([
      { path: 'index.html', content: '<main>Saved preview</main>' },
      { path: 'styles.css', content: 'body { color: cyan; }' },
    ]);
  });
});
