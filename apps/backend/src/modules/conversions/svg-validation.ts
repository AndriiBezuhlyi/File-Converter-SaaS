import { SaxesParser } from 'saxes';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES } from './conversion-policy.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const elements = new Set([
  'svg',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'title',
  'desc',
]);
const geometry = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'stroke-width',
  'stroke-miterlimit',
]);
const numbers = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numberList = /^[\d\s.,+eE-]+$/;
const reject = () => {
  throw new Error('Unsupported or unsafe SVG.');
};
const finiteNumber = (value: string) =>
  numbers.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1_000_000;

// A deliberately small static SVG language. No CSS, text/font rendering, references,
// embedded content, filters, animation, namespace aliases or resource-bearing attributes.
export function validateSvg(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) reject();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let depth = 0;
  let count = 0;
  let complexity = 0;
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
  parser.on('error', reject);
  parser.on('doctype', reject);
  parser.on('processinginstruction', reject);
  parser.on('cdata', reject);
  parser.on('xmldecl', (declaration) => {
    if (
      declaration.version !== '1.0' ||
      (declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8')
    )
      reject();
  });
  parser.on('opentag', (tag) => {
    if (
      ++depth > 32 ||
      ++count > 10_000 ||
      tag.uri !== SVG_NS ||
      tag.prefix ||
      !elements.has(tag.local)
    )
      reject();
    if ((depth === 1 && tag.local !== 'svg') || (depth !== 1 && tag.local === 'svg')) reject();
    const attributes = Object.values(tag.attributes);
    if (attributes.length > 24) reject();
    for (const attribute of attributes) {
      const { name, value } = attribute;
      complexity += value.length;
      if (value.length > 100_000 || complexity > 1_000_000) reject();
      if (name === 'xmlns' && depth === 1 && value === SVG_NS) continue;
      if (attribute.uri || attribute.prefix) reject();
      if (geometry.has(name)) {
        if (!finiteNumber(value)) reject();
        continue;
      }
      if (name === 'viewBox' || name === 'points') {
        const values = value.trim().split(/[\s,]+/);
        if (
          !numberList.test(value) ||
          !values.every(finiteNumber) ||
          (name === 'viewBox' &&
            (values.length !== 4 || Number(values[2]) <= 0 || Number(values[3]) <= 0))
        )
          reject();
        continue;
      }
      if (name === 'd') {
        if (tag.local !== 'path' || !/^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]+$/.test(value)) reject();
        continue;
      }
      if (name === 'fill' || name === 'stroke') {
        if (
          !/^(?:none|transparent|#[\da-fA-F]{3}|#[\da-fA-F]{6}|black|white|red|green|blue|yellow|gray)$/.test(
            value,
          )
        )
          reject();
        continue;
      }
      if (name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity') {
        if (!finiteNumber(value) || Number(value) < 0 || Number(value) > 1) reject();
        continue;
      }
      if (
        (name === 'fill-rule' && ['nonzero', 'evenodd'].includes(value)) ||
        (name === 'stroke-linecap' && ['butt', 'round', 'square'].includes(value)) ||
        (name === 'stroke-linejoin' && ['miter', 'round', 'bevel'].includes(value))
      )
        continue;
      reject();
    }
    if (depth === 1) {
      const width = Number(tag.attributes.width?.value);
      const height = Number(tag.attributes.height?.value);
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width * height > MAX_IMAGE_PIXELS
      )
        reject();
    }
  });
  parser.on('closetag', () => {
    depth--;
  });
  parser.on('text', (value) => {
    if (value.trim()) reject();
  });
  // Feed bounded chunks; total input and attribute complexity have independent limits.
  for (let offset = 0; offset < text.length; offset += 4096)
    parser.write(text.slice(offset, offset + 4096));
  parser.close();
  if (!count || depth !== 0) reject();
}
