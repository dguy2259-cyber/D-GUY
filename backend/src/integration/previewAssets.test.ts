import { describe, expect, it } from 'vitest';
import { localAssetDataUrl, rewriteLocalCssAssets } from '../../../src/services/previewAssets.ts';
import type { ProjectFile } from '../../../src/types/project.ts';

const files = [
  { path: 'assets/mark.svg', content: '<svg>✓</svg>' },
  { path: 'styles/site.css', content: '' },
] as ProjectFile[];

describe('isolated preview asset resolution', () => {
  it('embeds local image assets as data URLs', () => {
    expect(localAssetDataUrl('../assets/mark.svg', 'styles', files)).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg>✓</svg>', 'utf8').toString('base64')}`);
  });
  it('preserves safe inline data assets and rejects traversal or remote URLs', () => {
    expect(localAssetDataUrl('data:image/png;base64,AAAA', '', files)).toBe('data:image/png;base64,AAAA');
    expect(localAssetDataUrl('../../secret.svg', 'styles', files)).toBeUndefined();
    expect(localAssetDataUrl('https://example.com/a.svg', '', files)).toBeUndefined();
  });
  it('rewrites CSS local URLs and drops remote imports/resources for offline fallback', () => {
    const css = '@import url(https://fonts.example/font.css); .logo{background:url("../assets/mark.svg")} .shape{fill:url(#gradient)} .remote{background:url(https://example.com/x.png)}';
    const rewritten = rewriteLocalCssAssets(css, 'styles/site.css', files);
    expect(rewritten).toContain('data:image/svg+xml;base64,');
    expect(rewritten).not.toContain('fonts.example');
    expect(rewritten).not.toContain('example.com');
    expect(rewritten).toContain('url("data:,")');
    expect(rewritten).toContain('url("#gradient")');
  });
});
