// This entry point runs only inside the per-attempt Linux sandbox, without service credentials.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { MAX_IMAGE_PIXELS } from './conversion-policy.js';

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
    return (source === 'jpg' && target === 'png') || (source === 'png' && target === 'jpg');
  }
  async convert(inputPath: string, outputPath: string, { target }: { target: string }) {
    const { default: sharp } = await import('sharp');
    sharp.cache(false);
    sharp.concurrency(1);
    const image = sharp(inputPath, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' })
      .autoOrient()
      .timeout({ seconds: 45 });
    await (
      target === 'jpg'
        ? image.flatten({ background: '#ffffff' }).jpeg({ quality: 90 })
        : image.png()
    ).toFile(outputPath);
  }
}

class LibreOfficeDocumentConverter implements Converter {
  supports(source: string, target: string) {
    return source === 'docx' && target === 'pdf';
  }
  async convert(
    inputPath: string,
    outputPath: string,
    _options: { target: string },
    { signal }: { signal: AbortSignal },
  ) {
    await mkdir('/work/profile/user', { recursive: true });
    await writeFile(
      '/work/profile/user/registrymodifications.xcu',
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>',
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
          'pdf:writer_pdf_Export',
          '--outdir',
          '/work',
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
  const adapters: Converter[] = [new SharpImageConverter(), new LibreOfficeDocumentConverter()];
  const adapter = adapters.find((candidate) => candidate.supports(source, target));
  if (!adapter || !target) throw new Error('Unsupported direction.');
  await mkdir('/work/tmp', { recursive: true });
  await adapter.convert(
    source === 'docx' ? '/input.docx' : '/input',
    '/work/result',
    { target },
    { signal: AbortSignal.timeout(55_000) },
  );
  const result = await readFile('/work/result');
  if (!result.length || result.length > 40_000_000) throw new Error('Output limit.');
  process.stdout.write(result);
}
void main().catch(() => {
  process.exitCode = 1;
});
