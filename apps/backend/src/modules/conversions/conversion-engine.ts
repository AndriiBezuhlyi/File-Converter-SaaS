import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SourceFormat, TargetFormat } from './conversion-policy.js';
import { isDocumentSource } from './document-input.js';

export class EngineFailure extends Error {}
export const ENGINE_TIMEOUT_MS = 60_000;
export const MAX_RESULT_BYTES = 40_000_000;

export function sandboxArguments(input: string, source: SourceFormat, target: TargetFormat) {
  return [
    '--as=2147483648',
    '--cpu=50',
    '--fsize=40000000',
    '--nofile=128',
    '--core=0',
    '/usr/bin/bwrap',
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--clearenv',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    '--setenv',
    'HOME',
    '/work',
    '--setenv',
    'TMPDIR',
    '/work/tmp',
    '--setenv',
    'LANG',
    'C.UTF-8',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind-try',
    '/lib64',
    '/lib64',
    '--ro-bind-try',
    '/etc/fonts',
    '/etc/fonts',
    '--ro-bind',
    '/etc/ld.so.cache',
    '/etc/ld.so.cache',
    '--ro-bind-try',
    '/etc/libreoffice',
    '/etc/libreoffice',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--size',
    '134217728',
    '--tmpfs',
    '/work',
    '--symlink',
    '/work/tmp',
    '/tmp',
    '--ro-bind',
    resolve('../../node_modules'),
    '/app/node_modules',
    '--ro-bind',
    fileURLToPath(new URL('./engine-process.js', import.meta.url)),
    '/app/engine-process.js',
    '--ro-bind',
    fileURLToPath(new URL('./conversion-policy.js', import.meta.url)),
    '/app/conversion-policy.js',
    ...['image-input.js', 'svg-validation.js', 'document-input.js', 'docx-validation.js'].flatMap(
      (name) => ['--ro-bind', fileURLToPath(new URL(`./${name}`, import.meta.url)), `/app/${name}`],
    ),
    '--ro-bind',
    input,
    isDocumentSource(source) ? `/input.${source}` : '/input',
    '--remount-ro',
    '/dev',
    '--remount-ro',
    '/proc',
    '--remount-ro',
    '/',
    '--chdir',
    '/work',
    '/usr/local/bin/node',
    '--jitless',
    '--max-old-space-size=128',
    '/app/engine-process.js',
    source,
    target,
  ];
}

@Injectable()
export class ConversionEngine {
  private readonly active = new Set<() => void>();
  private stopping = false;
  beforeApplicationShutdown() {
    this.stopping = true;
    for (const kill of this.active) kill();
  }
  async convert(input: string, source: SourceFormat, target: TargetFormat): Promise<Buffer> {
    return this.run(sandboxArguments(input, source, target));
  }
  async validateImage(input: string, source: SourceFormat): Promise<void> {
    const args = sandboxArguments(input, source, 'png');
    args.push('--validate-only');
    if ((await this.run(args)).toString() !== 'valid') throw new EngineFailure('Invalid image.');
  }
  async check() {
    const args = sandboxArguments('/dev/null', 'jpg', 'png');
    args.splice(
      -3,
      3,
      '-e',
      "const fs=require('node:fs');fs.accessSync('/usr/lib/libreoffice/program/soffice.bin',1);for(const name of ['writer','calc','impress'])fs.accessSync('/etc/libreoffice/registry/'+name+'.xcd');require('node:module').createRequire('/app/engine-process.js')('sharp');process.stdout.write('ready')",
    );
    if ((await this.run(args)).toString() !== 'ready') throw new Error('Sandbox unavailable.');
  }
  private async run(args: string[]): Promise<Buffer> {
    if (this.stopping) throw new Error('Worker stopping.');
    if (process.platform !== 'linux') throw new Error('Linux conversion sandbox required.');
    // RLIMIT_NPROC counts a host UID across containers and breaks independent replicas.
    // One active conversion shares a mandatory, per-worker cgroup budget with its orchestrator.
    const [processLimit, memoryLimit, cpuLimit] = await Promise.all(
      ['pids.max', 'memory.max', 'cpu.max'].map((name) =>
        readFile(`/sys/fs/cgroup/${name}`, 'utf8'),
      ),
    );
    const [quota, period] = cpuLimit!.trim().split(/\s+/).map(Number);
    if (
      !Number.isFinite(Number(processLimit)) ||
      Number(processLimit) > 128 ||
      !Number.isFinite(Number(memoryLimit)) ||
      Number(memoryLimit) > 1_073_741_824 ||
      !quota ||
      !period ||
      quota / period > 1
    )
      throw new Error('Bounded worker cgroup required.');
    return new Promise((resolveResult, reject) => {
      const child = spawn('/usr/bin/prlimit', args, {
        env: {},
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let exceeded = false;
      const kill = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* Already exited. */
          }
        }
      };
      const timer = setTimeout(() => {
        exceeded = true;
        kill();
      }, ENGINE_TIMEOUT_MS);
      this.active.add(kill);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESULT_BYTES) {
          exceeded = true;
          kill();
        } else chunks.push(chunk);
      });
      child.once('error', () => {
        clearTimeout(timer);
        this.active.delete(kill);
        reject(new Error('Sandbox unavailable.'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        this.active.delete(kill);
        if (this.stopping) reject(new Error('Worker stopping.'));
        else if (code !== 0 || exceeded || !size)
          reject(new EngineFailure('Conversion engine failed.'));
        else resolveResult(Buffer.concat(chunks));
      });
    });
  }
}
