import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/api/generated/prisma/client.js';
import { FilesService } from '../dist/api/modules/files/files.service.js';

// Explicit disposable target and baseline build only; never load dotenv or DATABASE_URL.
const target = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
if (
  target.protocol !== 'postgresql:' ||
  target.hostname !== '127.0.0.1' ||
  target.search ||
  target.pathname !== '/converter_test_f08_bench' ||
  !process.argv[2] ||
  !process.argv[3]
)
  throw new Error(
    'Explicit loopback converter_test_f08_bench, baseline module and report required.',
  );
const { FilesService: BaselineFilesService } = await import(
  pathToFileURL(resolve(process.argv[2])).href
);
const pool = new pg.Pool({ connectionString: target.href, max: 5, statement_timeout: 10000 });
const client = new PrismaClient({
  adapter: new PrismaPg(pool, { disposeExternalPool: false }),
  log: [{ emit: 'event', level: 'query' }],
});
let captured;
client.$on('query', (event) => {
  captured = { sql: event.query, params: JSON.parse(event.params) };
});
const services = {
  before: new BaselineFilesService({ client }, {}),
  after: new FilesService({ client }, {}),
};
const userId = randomUUID();
const report = {
  at: new Date().toISOString(),
  version: (await pool.query('SELECT version()')).rows[0].version,
  seed: { saved: 100000, inputs: 100000, timestampTieSize: 10, pageSize: 20 },
  repetitions: 3,
  samplesPerRepetition: 40,
  measurements: [],
};
try {
  await client.user.create({
    data: { id: userId, email: `${userId}@example.test`, passwordHash: 'synthetic' },
  });
  await pool.query(
    `INSERT INTO "File" ("userId","objectKey","originalName",format,"detectedMime","sizeBytes",purpose,retention,"createdAt","updatedAt")
     SELECT $1,'f08-benchmark/'||gen_random_uuid(),
       CASE WHEN i%3=0 THEN 'Needle%_-' ELSE 'ordinary-' END||i||'.'||CASE WHEN i%2=0 THEN 'png' ELSE 'pdf' END,
       CASE WHEN i%2=0 THEN 'png'::"FileFormat" ELSE 'pdf'::"FileFormat" END,
       CASE WHEN i%2=0 THEN 'image/png' ELSE 'application/pdf' END,100,'output','saved',
       '2026-01-01'::timestamptz+(i/10)*interval '1 millisecond',now()
     FROM generate_series(1,100000) i`,
    [userId],
  );
  await pool.query(
    `INSERT INTO "File" ("userId","objectKey","originalName",format,"detectedMime","sizeBytes",purpose,retention,"createdAt","updatedAt")
     SELECT $1,'f08-benchmark/'||gen_random_uuid(),'synthetic-input.png','png','image/png',100,'input','temporary',
       CASE WHEN i%2=0 THEN '2027-01-01'::timestamptz ELSE '2025-01-01'::timestamptz END,now()
     FROM generate_series(1,100000) i`,
    [userId],
  );
  await pool.query('ANALYZE "File"');
  for (const sort of ['newest', 'oldest']) {
    const anchor = (
      await pool.query(
        `SELECT id,"createdAt" FROM "File" WHERE "userId"=$1 AND purpose='output'
         ORDER BY "createdAt",id OFFSET 50000 LIMIT 1`,
        [userId],
      )
    ).rows[0];
    for (const filters of [
      {},
      { format: 'png' },
      { search: 'needle%_' },
      { format: 'pdf', search: 'needle%_' },
    ]) {
      const query = {
        ...filters,
        sort,
        cursor: Buffer.from(
          JSON.stringify({
            id: anchor.id,
            createdAt: anchor.createdAt.toISOString(),
            sort,
            search: filters.search ?? '',
            format: filters.format ?? null,
          }),
        ).toString('base64url'),
      };
      const measurements = { before: [], after: [] };
      const expected = await services.before.list(userId, query);
      assert.deepEqual(await services.after.list(userId, query), expected);
      assert(!expected.items.some((row) => row.id === anchor.id));
      for (let repetition = 0; repetition < 3; repetition++) {
        // Rotate variant order; both builds use the same immutable seeded rows and pool.
        for (const variant of repetition % 2 ? ['after', 'before'] : ['before', 'after']) {
          for (let sample = 0; sample < 40; sample++) {
            const start = performance.now();
            const page = await services[variant].list(userId, query);
            const elapsed = performance.now() - start;
            assert.deepEqual(page, expected);
            measurements[variant].push(elapsed);
          }
        }
      }
      for (const variant of ['before', 'after']) {
        await services[variant].list(userId, query);
        const emitted = captured;
        assert(emitted.sql.startsWith('SELECT'));
        const plan = await pool.query(
          'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + emitted.sql,
          emitted.params,
        );
        const times = measurements[variant].sort((a, b) => a - b);
        const result = {
          variant,
          sort,
          filters,
          samples: times.length,
          p50: times[59],
          p95: times[113],
          p99: times[118],
          sql: emitted.sql,
          plan: plan.rows[0]['QUERY PLAN'],
        };
        report.measurements.push(result);
        console.log(JSON.stringify({ ...result, sql: undefined, plan: undefined }));
      }
    }
  }
  report.identicalPagesAndCursors = true;
  await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2));
} finally {
  // Bound fixture teardown too; deleting 200k rows at once can exceed the unchanged timeout.
  while (
    (
      await pool.query(
        'DELETE FROM "File" WHERE id IN (SELECT id FROM "File" WHERE "userId"=$1::uuid LIMIT 250)',
        [userId],
      )
    ).rowCount
  ) {
    /* Only this run's synthetic owner is eligible. */
  }
  await client.user.deleteMany({ where: { id: userId } });
  await client.$disconnect();
  await pool.end();
}
