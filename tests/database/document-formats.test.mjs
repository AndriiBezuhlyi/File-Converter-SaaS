import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !/^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
)
  throw new Error('Explicit disposable test database required.');

test('additive document migrations preserve legacy rows and enforce exact pair/MIME constraints', async () => {
  const db = new pg.Client({ connectionString: url.toString() });
  const schema = `document_test_${randomUUID().replaceAll('-', '')}`;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    const root = new URL('../../apps/backend/prisma/migrations/', import.meta.url);
    const migrations = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const apply = (name) =>
      readFile(new URL(`${name}/migration.sql`, root), 'utf8').then((sql) => db.query(sql));
    for (const migration of migrations.filter((name) => name < '20261109000002'))
      await apply(migration);
    const userId = (
      await db.query('INSERT INTO "User" (email,"passwordHash") VALUES ($1,$2) RETURNING id', [
        `${randomUUID()}@example.test`,
        'synthetic',
      ])
    ).rows[0].id;
    const file = async (format, mime) =>
      (
        await db.query(
          'INSERT INTO "File" ("userId","objectKey","originalName",format,"detectedMime","sizeBytes",purpose) VALUES ($1,$2,$3,$4,$5,10,\'input\') RETURNING id',
          [userId, `synthetic/${randomUUID()}`, `input.${format}`, format, mime],
        )
      ).rows[0].id;
    const conversion = (id, source, target) =>
      db.query(
        'INSERT INTO "Conversion" ("userId","sourceFileId","sourceFormat","targetFormat") VALUES ($1,$2,$3,$4) RETURNING id',
        [userId, id, source, target],
      );
    const legacy = await file('jpg', 'image/jpeg');
    const legacyJob = (await conversion(legacy, 'jpg', 'png')).rows[0].id;
    for (const migration of migrations.filter((name) => name >= '20261109000002'))
      await apply(migration);
    assert.equal(
      (await db.query('SELECT "sourceFileId" FROM "Conversion" WHERE id=$1', [legacyJob])).rows[0]
        .sourceFileId,
      legacy,
    );
    const directions = {
      docx: ['pdf'],
      odt: ['pdf'],
      xlsx: ['pdf'],
      pptx: ['pdf'],
      csv: ['pdf'],
      txt: ['pdf'],
    };
    for (const [source, targets] of Object.entries(directions)) {
      const input = () =>
        file(
          source,
          {
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            odt: 'application/vnd.oasis.opendocument.text',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            csv: 'text/csv',
            txt: 'text/plain',
          }[source],
        );
      for (const target of targets) await conversion(await input(), source, target);
      for (const target of [
        'jpg',
        'png',
        'webp',
        'avif',
        'svg',
        'gif',
        'docx',
        'odt',
        'xlsx',
        'pptx',
        'csv',
        'txt',
        'pdf',
      ].filter((value) => !targets.includes(value)))
        await assert.rejects(conversion(await input(), source, target), {
          constraint: 'Conversion_supported_pair',
        });
      await assert.rejects(file(source, 'application/octet-stream'), {
        constraint: 'File_mime_matches_format',
      });
    }
  } finally {
    await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.end();
  }
});
