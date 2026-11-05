import { inflateRawSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES } from './conversion-policy.js';

// Deliberately accept a constrained OPC ZIP subset. No ZIP64, encryption, nested archives,
// macros, embedded programs or external relationships reach the document worker.
export function validateDocx(bytes: Buffer): void {
  const invalid = () => {
    throw new Error('Invalid document archive.');
  };
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65_535);
  while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < minimum || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) invalid();
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > MAX_ARCHIVE_ENTRIES ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    start + bytes.readUInt32LE(end + 12) !== end
  )
    invalid();
  let cursor = start;
  let expanded = 0;
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  const xml = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const packed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const next = cursor + 46 + nameLength + extraLength + bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    if (next > end || flags & ~0x808 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34))
      invalid();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (
      !name ||
      names.has(name.toLowerCase()) ||
      name.includes('\uFFFD') ||
      /[\\:]/.test(name) ||
      Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '..' || part === '.') ||
      /(?:vbaproject|activex|embeddings|oleobject)/i.test(name) ||
      /\.(?:zip|docx|docm|exe|dll|bin)$/i.test(name)
    )
      invalid();
    names.add(name.toLowerCase());
    expanded += size;
    if (
      expanded > MAX_ARCHIVE_BYTES ||
      size > Math.max(1, packed) * 200 ||
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 26) !== nameLength
    )
      invalid();
    const dataStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
    const dataEnd = dataStart + packed;
    if (
      dataEnd > start ||
      !bytes.subarray(local + 30, local + 30 + nameLength).equals(nameBytes) ||
      ranges.some(([from, to]) => local < to && dataEnd > from)
    )
      invalid();
    if (
      !(flags & 8) &&
      (bytes.readUInt32LE(local + 14) !== bytes.readUInt32LE(cursor + 16) ||
        bytes.readUInt32LE(local + 18) !== packed ||
        bytes.readUInt32LE(local + 22) !== size)
    )
      invalid();
    if (((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) invalid();
    ranges.push([local, dataEnd]);
    const compressed = bytes.subarray(dataStart, dataEnd);
    const data =
      method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size || crc32(data) !== bytes.readUInt32LE(cursor + 16)) invalid();
    if (/\.(?:xml|rels)$/i.test(name)) {
      // UTF-8 only avoids alternate encodings bypassing active-content checks.
      const text = data.toString('utf8');
      if ((name.endsWith('.rels') || name === '[Content_Types].xml') && text.includes('&#'))
        invalid();
      if (
        text.includes('\u0000') ||
        text.includes('\uFFFD') ||
        /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text) ||
        /encoding\s*=\s*["'](?!utf-8["'])/i.test(text) ||
        /TargetMode\s*=\s*["']External["']/i.test(text) ||
        /(?:macroEnabled|vbaProject|attachedTemplate|altChunk|oleObject)/i.test(text) ||
        /\bTarget\s*=\s*["'][^"']*(?:&#|:\/\/|file:|\\\\)/i.test(text)
      )
        invalid();
      xml.set(name, text);
    }
    cursor = next;
  }
  if (
    cursor !== end ||
    !xml
      .get('[Content_Types].xml')
      ?.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      ) ||
    !xml.get('_rels/.rels')?.includes('officeDocument') ||
    !xml.get('word/document.xml')?.match(/<(?:\w+:)?document[\s>]/)
  )
    invalid();
}
