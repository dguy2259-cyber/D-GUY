import { describe, expect, it } from 'vitest';
import { createPartialFileSnapshot } from './partialFiles.js';

describe('partial generated files', () => {
  it('keeps unchanged project files and replaces files that were streamed before stopping', () => {
    const snapshot = createPartialFileSnapshot(
      [
        { path: 'index.html', content: '<main>Old</main>' },
        { path: 'styles.css', content: 'body { color: black; }' },
      ],
      new Map([['index.html', '<main>New but incomplete']]),
    );

    expect(snapshot).toEqual([
      { path: 'index.html', content: '<main>New but incomplete' },
      { path: 'styles.css', content: 'body { color: black; }' },
    ]);
  });

  it('does not save when there is no non-empty output or a streamed path is unsafe', () => {
    expect(createPartialFileSnapshot([], new Map([['index.html', '']]))).toBeUndefined();
    expect(createPartialFileSnapshot([], new Map([['../secrets.txt', 'partial']]))).toBeUndefined();
  });
});
