import { describe, expect, it } from 'vitest';
import { createSafeZip, projectFilesSchema } from './files.js';

describe('project file security', () => {
  it.each(['../secret.txt', '/etc/passwd', 'src/../../secret', 'src\\app.ts', '.env', 'src/.env.local', 'node_modules/a.js', 'x.pem', '.npmrc', 'build.zip', 'app.exe'])('rejects unsafe path %s', (path) => {
    expect(projectFilesSchema.safeParse([{ path, content: 'x' }]).success).toBe(false);
  });
  it('rejects duplicate names and oversized content', () => {
    expect(projectFilesSchema.safeParse([{ path: 'a.ts', content: '1' }, { path: 'a.ts', content: '2' }]).success).toBe(false);
    expect(projectFilesSchema.safeParse([{ path: 'a.ts', content: 'x'.repeat(100_001) }]).success).toBe(false);
  });
  it('creates a bounded ZIP archive from validated text files', () => {
    const archive = createSafeZip([{ path: 'src/App.tsx', content: 'export default 1' }]);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(() => createSafeZip([{ path: 'src/App.tsx', content: 'x'.repeat(100) }], 64)).toThrow(/size limit/);
  });

  it('keeps the requested paths and contents in the ZIP archive', () => {
    const files = [
      { path: 'index.html', content: '<h1>D-GUY</h1>' },
      { path: 'src/App.tsx', content: 'export default 1' },
    ];
    const archive = createSafeZip(files);
    const extracted: Array<{ path: string; content: string }> = [];
    let offset = 0;
    while (archive.readUInt32LE(offset) === 0x04034b50) {
      const nameLength = archive.readUInt16LE(offset + 26);
      const extraLength = archive.readUInt16LE(offset + 28);
      const contentLength = archive.readUInt32LE(offset + 18);
      const nameStart = offset + 30;
      const contentStart = nameStart + nameLength + extraLength;
      extracted.push({
        path: archive.toString('utf8', nameStart, nameStart + nameLength),
        content: archive.toString('utf8', contentStart, contentStart + contentLength),
      });
      offset = contentStart + contentLength;
    }

    expect(extracted).toEqual(files);
  });
});
