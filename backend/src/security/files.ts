import { z } from 'zod';

/* eslint-disable no-control-regex */

const blockedPath = /(^|\/)(?:\.env(?:\..*)?|\.git|\.aws|\.ssh|\.npmrc|\.pypirc|\.netrc|node_modules|logs?|credentials?|secrets?)(?:\/|$)|(^|\/)[^/]*\.(?:pem|key|log|p12|pfx|exe|dll|so|bin|zip|gz|tar|7z)$/i;
export const projectFileSchema = z.object({
  path: z.string().min(1).max(240).refine((value) => {
    if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f]/.test(value) || blockedPath.test(value)) return false;
    return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
  }, 'Unsafe file path'),
  content: z.string().max(100_000),
}).strict();

export const projectFilesSchema = z.array(projectFileSchema).min(1).max(30).superRefine((files, ctx) => {
  const names = new Set<string>(); let total = 0;
  for (const [index, file] of files.entries()) {
    if (names.has(file.path)) ctx.addIssue({ code: 'custom', path: [index, 'path'], message: 'Duplicate path' });
    names.add(file.path); total += Buffer.byteLength(file.content, 'utf8');
  }
  if (total > 500_000) ctx.addIssue({ code: 'custom', message: 'Project output exceeds 500 KB' });
});

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

export function createSafeZip(input: unknown, maxBytes = 5_000_000): Buffer {
  const parsed = projectFilesSchema.parse(input);
  const files = parsed.filter(({ path }) => !blockedPath.test(path));
  if (files.length !== parsed.length) throw new Error('Archive includes a prohibited file');
  const localParts: Buffer[] = []; const centralParts: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8'); const data = Buffer.from(file.content, 'utf8'); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name); offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((n, part) => n + part.length, 0); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...localParts, ...centralParts, end]);
  if (archive.length > maxBytes) throw new Error('Archive exceeds size limit');
  return archive;
}
