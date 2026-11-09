// This entry point runs only inside the per-attempt Linux sandbox, without service credentials.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { CONVERSION_DIRECTIONS, MAX_IMAGE_PIXELS, type SourceFormat } from './conversion-policy.js';
import { validateImageInput } from './image-input.js';
import {
  csvSpreadsheet,
  isDocumentSource,
  validateDocument,
  validateText,
} from './document-input.js';

interface Converter {
  supports(source: string | undefined, target: string | undefined): boolean;
  convert(
    inputPath: string,
    outputPath: string,
    options: { target: string },
    executionContext: { signal: AbortSignal },
  ): Promise<void>;
}

class SharpImageConverter implements Converter {
  supports(source: string, target: string) {
    return (
      !isDocumentSource(source) &&
      Object.hasOwn(CONVERSION_DIRECTIONS, source) &&
      (CONVERSION_DIRECTIONS[source as SourceFormat] as readonly string[]).includes(target)
    );
  }
  async convert(inputPath: string, outputPath: string, { target }: { target: string }) {
    const { default: sharp } = await import('sharp');
    sharp.cache(false);
    sharp.concurrency(1);
    await validateImageInput(inputPath, process.argv[2]!);
    const image = sharp(inputPath, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' })
      .autoOrient()
      .timeout({ seconds: 45 });
    await (
      target === 'jpg'
        ? image.flatten({ background: '#ffffff' }).jpeg({ quality: 90 })
        : target === 'webp'
          ? image.webp({ quality: 80, effort: 4 })
          : target === 'avif'
            ? image.avif({ quality: 50, effort: 4, bitdepth: 8 })
            : image.png()
    ).toFile(outputPath);
  }
}

class LibreOfficeDocumentConverter implements Converter {
  supports(source: string, target: string) {
    return isDocumentSource(source) && target === 'pdf';
  }
  async convert(
    inputPath: string,
    outputPath: string,
    _options: { target: string },
    { signal }: { signal: AbortSignal },
  ) {
    const source = process.argv[2]!;
    if (!isDocumentSource(source)) throw new Error('Unsupported document.');
    const bytes = await readFile(inputPath);
    validateDocument(bytes, source);
    if (source === 'csv') {
      inputPath = '/work/input.fods';
      await writeFile(inputPath, csvSpreadsheet(bytes));
    } else if (source === 'txt') {
      inputPath = '/work/input.txt';
      await writeFile(inputPath, validateText(bytes));
    }
    await mkdir('/work/profile/user', { recursive: true });
    await writeFile(
      '/work/profile/user/registrymodifications.xcu',
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>',
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        '/usr/bin/libreoffice',
        [
          '-env:UserInstallation=file:///work/profile',
          '--headless',
          '--nologo',
          '--nodefault',
          '--nofirststartwizard',
          '--norestore',
          '--convert-to',
          `pdf:${source === 'xlsx' || source === 'csv' ? 'calc' : source === 'pptx' ? 'impress' : 'writer'}_pdf_Export:${JSON.stringify({ ExportNotes: { type: 'boolean', value: 'false' }, ExportNotesPages: { type: 'boolean', value: 'false' }, ExportOnlyNotesPages: { type: 'boolean', value: 'false' }, ExportHiddenSlides: { type: 'boolean', value: 'false' } })}`,
          '--outdir',
          '/work',
          ...(source === 'txt' ? ['--infilter=Text (encoded):UTF8,LF,Carlito,en-US'] : []),
          inputPath,
        ],
        { stdio: 'ignore', signal },
      );
      child.once('error', reject);
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Engine failed.'))));
    });
    await rename('/work/input.pdf', outputPath);
  }
}

async function main() {
  const [source, target] = process.argv.slice(2);
  if (process.argv[4] === '--validate-only') {
    await validateImageInput('/input', source!);
    process.stdout.write('valid');
    return;
  }
  const adapters: Converter[] = [new SharpImageConverter(), new LibreOfficeDocumentConverter()];
  const adapter = adapters.find((candidate) => candidate.supports(source, target));
  if (!adapter || !target) throw new Error('Unsupported direction.');
  await mkdir('/work/tmp', { recursive: true });
  await adapter.convert(
    isDocumentSource(source!) ? `/input.${source}` : '/input',
    '/work/result',
    { target },
    { signal: AbortSignal.timeout(55_000) },
  );
  const result = await readFile('/work/result');
  if (!result.length || result.length > 40_000_000) throw new Error('Output limit.');
  if (
    target === 'pdf' &&
    (result.subarray(0, 5).toString() !== '%PDF-' || !result.includes(Buffer.from('%%EOF')))
  )
    throw new Error('Invalid PDF output.');
  process.stdout.write(result);
}
void main().catch(() => {
  process.exitCode = 1;
});
