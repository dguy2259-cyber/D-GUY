import type { ProjectFile } from '@/types/project';

const MIME_TYPES: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function normalizedLocalPath(reference: string, basePath: string): string | undefined {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0] ?? ''); } catch { return undefined; }
  if (decoded.startsWith('/')) decoded = decoded.slice(1);
  else decoded = `${basePath ? `${basePath}/` : ''}${decoded}`;
  const parts: string[] = [];
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); continue; }
    if (part.includes('\\') || part.includes('\0')) return undefined;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : undefined;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function localAssetDataUrl(reference: string, basePath: string, files: readonly ProjectFile[]): string | undefined {
  if (/^data:(?:image|font)\//i.test(reference)) return reference;
  const path = normalizedLocalPath(reference, basePath);
  const content = path && files.find((file) => file.path === path)?.content;
  if (content === undefined) return undefined;
  const extension = path!.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_TYPES[extension];
  if (!mime) return undefined;
  return `data:${mime};base64,${encodeBase64(content)}`;
}

export function rewriteLocalCssAssets(css: string, stylesheetPath: string, files: readonly ProjectFile[]): string {
  const basePath = stylesheetPath.includes('/') ? stylesheetPath.slice(0, stylesheetPath.lastIndexOf('/')) : '';
  return css
    .replace(/@import\s+(?:url\([^)]*\)|['"][^'"]*['"])[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, _quote: string, reference: string) => {
      if (reference.trim().startsWith('#')) return `url("${reference.trim()}")`;
      const dataUrl = localAssetDataUrl(reference.trim(), basePath, files);
      return dataUrl ? `url("${dataUrl}")` : 'url("data:,")';
    });
}
