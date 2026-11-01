import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import pg from 'pg';

// No dotenv: an explicit, disposable loopback target is required; never use DATABASE_URL.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL to a local converter_test database.');
let target;
try {
  target = new URL(connectionString);
} catch {
  throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL test target.');
}
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  target.search ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  !/^\/converter_test(?:_[a-z0-9_]+)?$/.test(target.pathname)
)
  throw new Error('Database tests require a loopback host and a converter_test database.');

const schema = `converter_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString });
const pool = new pg.Pool({
  connectionString,
  max: 4,
  options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=5000`,
});
let schemaCreated = false;

before(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const migrations = new URL('../../apps/backend/prisma/migrations/', import.meta.url);
  const directories = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const client = await pool.connect();
  try {
    for (const directory of directories)
      await client.query(await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'));
  } finally {
    client.release();
  }
});

after(async () => {
  await pool.end();
  // The only destructive operation targets this run's generated schema, never public/user data.
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

const query = (sql, values = []) => pool.query(sql, values);
const rejection = (operation, code, constraint) =>
  assert.rejects(operation, constraint ? { code, constraint } : { code });

async function user() {
  const result = await query(
    'INSERT INTO "User" (email, "passwordHash") VALUES ($1, $2) RETURNING id',
    [`${randomUUID()}@example.test`, 'synthetic-password-hash'],
  );
  return { userId: result.rows[0].id };
}

async function guest() {
  const result = await query(
    `INSERT INTO "GuestSession" ("tokenHash", "credentialExpiresAt")
     VALUES ($1, now() + interval '1 day') RETURNING id`,
    [`synthetic-hash-${randomUUID()}`],
  );
  return { guestSessionId: result.rows[0].id };
}

async function file(owner, options = {}) {
  const format = options.format ?? 'jpg';
  const mime = {
    jpg: 'image/jpeg',
    png: 'image/png',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
  }[format];
  const result = await query(
    `INSERT INTO "File" ("userId", "guestSessionId", "objectKey", "originalName", format,
       "detectedMime", "sizeBytes", purpose, retention, "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      owner.userId ?? null,
      owner.guestSessionId ?? null,
      `synthetic/${randomUUID()}`,
      `example.${format}`,
      format,
      options.mime ?? mime,
      options.size ?? 123,
      options.purpose ?? 'input',
      options.retention ?? 'temporary',
      options.expiresAt ?? null,
    ],
  );
  return result.rows[0].id;
}

async function conversion(owner, options = {}) {
  const source = options.source ?? (await file(owner));
  const result = await query(
    `INSERT INTO "Conversion" ("userId", "guestSessionId", "sourceFileId", "sourceFormat", "targetFormat", "saveResult")
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      owner.userId ?? null,
      owner.guestSessionId ?? null,
      source,
      options.sourceFormat ?? 'jpg',
      options.targetFormat ?? 'png',
      options.saveResult ?? false,
    ],
  );
  return result.rows[0].id;
}

const complete = (id, result) =>
  query(
    `UPDATE "Conversion" SET status = 'completed', "resultFileId" = $2, "completedAt" = now(),
      "leaseToken" = NULL, "leaseExpiresAt" = NULL WHERE id = $1`,
    [id, result],
  );
const temporaryOutput = (owner) =>
  file(owner, { format: 'png', purpose: 'output', expiresAt: new Date(Date.now() + 3_600_000) });

test('normalized email, unique settings and credential lifetime are database invariants', async () => {
  await rejection(
    query('INSERT INTO "User" (email, "passwordHash") VALUES ($1, $2)', [
      ' Reader@Example.test ',
      'synthetic-hash',
    ]),
    '23514',
    'User_email_normalized',
  );
  const owner = await user();
  await query('INSERT INTO "UserSettings" ("userId") VALUES ($1)', [owner.userId]);
  await rejection(
    query('INSERT INTO "UserSettings" ("userId") VALUES ($1)', [owner.userId]),
    '23505',
  );
  await rejection(
    query(
      `INSERT INTO "VerificationToken" ("userId", purpose, "tokenHash", "expiresAt")
       VALUES ($1, 'password_reset', $2, now() - interval '1 second')`,
      [owner.userId, randomUUID()],
    ),
    '23514',
    'VerificationToken_expiry_valid',
  );
  await rejection(
    query(
      `INSERT INTO "VerificationToken" ("userId", purpose, "tokenHash", "expiresAt")
       VALUES ($1, 'email_change', $2, now() + interval '1 hour')`,
      [owner.userId, randomUUID()],
    ),
    '23514',
    'VerificationToken_email_change_target',
  );
});

test('concurrent API-key issuance permits one active key and transactional rotation', async () => {
  const owner = await user();
  const issue = () =>
    query('INSERT INTO "ApiKey" ("userId", prefix, "secretHash") VALUES ($1, $2, $3)', [
      owner.userId,
      randomUUID(),
      'synthetic-secret-hash',
    ]);
  const results = await Promise.allSettled([issue(), issue()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.equal(failure.reason.code, '23505');
  assert.equal(failure.reason.constraint, 'ApiKey_one_active_per_user');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE "ApiKey" SET "revokedAt" = now() WHERE "userId" = $1', [
      owner.userId,
    ]);
    await client.query(
      'INSERT INTO "ApiKey" ("userId", prefix, "secretHash") VALUES ($1, $2, $3)',
      [owner.userId, randomUUID(), 'replacement-hash'],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

test('file owner XOR, real format metadata and positive sizes are enforced', async () => {
  const owner = await user();
  const other = await guest();
  await rejection(file({}), '23514', 'File_exactly_one_owner');
  await rejection(file({ ...owner, ...other }), '23514', 'File_exactly_one_owner');
  await rejection(file(owner, { size: 0 }), '23514', 'File_size_positive');
  await rejection(file(owner, { mime: 'application/pdf' }), '23514', 'File_mime_matches_format');
  await rejection(
    file(other, { purpose: 'output', retention: 'saved', format: 'png' }),
    '23514',
    'File_retention_shape',
  );
});

test('conversion source cannot be taken from another account or guest or reassigned later', async () => {
  const owner = await user();
  const foreign = await user();
  const guestOwner = await guest();
  await rejection(
    conversion(owner, { source: randomUUID() }),
    '23503',
    'Conversion_sourceFileId_fkey',
  );
  await rejection(
    conversion(owner, { source: await file(foreign) }),
    '23514',
    'Conversion_source_matches',
  );
  await rejection(
    conversion(owner, { source: await file(guestOwner) }),
    '23514',
    'Conversion_source_matches',
  );
  const source = await file(owner);
  const id = await conversion(owner, { source });
  await rejection(
    query('UPDATE "File" SET "userId" = $2 WHERE id = $1', [source, foreign.userId]),
    '23514',
    'File_identity_immutable',
  );
  await rejection(
    query('UPDATE "Conversion" SET "userId" = $2 WHERE id = $1', [id, foreign.userId]),
    '23514',
    'Conversion_snapshot_immutable',
  );
});

test('supported conversion directions and acceptance-time retention stay consistent', async () => {
  const owner = await user();
  await rejection(conversion(owner, { targetFormat: 'pdf' }), '23514', 'Conversion_supported_pair');
  const id = await conversion(owner, { saveResult: true });
  await rejection(complete(id, await temporaryOutput(owner)), '23514', 'Conversion_result_matches');
  const output = await file(owner, { purpose: 'output', retention: 'saved', format: 'png' });
  await complete(id, output);
  await rejection(
    query('UPDATE "Conversion" SET "saveResult" = false WHERE id = $1', [id]),
    '23514',
    'Conversion_snapshot_immutable',
  );
  await rejection(
    query('UPDATE "File" SET retention = $2 WHERE id = $1', [output, 'temporary']),
    '23514',
    'File_identity_immutable',
  );
});

test('guest concurrency, reservation ownership and failure recovery have schema backstops', async () => {
  const owner = await guest();
  const sources = await Promise.all([file(owner), file(owner)]);
  const results = await Promise.allSettled(sources.map((source) => conversion(owner, { source })));
  const successes = results.filter((result) => result.status === 'fulfilled');
  assert.equal(successes.length, 1);
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.constraint,
    'Conversion_one_active_per_guest',
  );
  const id = successes[0].value;
  const stranger = await guest();
  await rejection(
    query(
      'UPDATE "GuestSession" SET "trialState" = $2, "reservedConversionId" = $3 WHERE id = $1',
      [stranger.guestSessionId, 'reserved', id],
    ),
    '23514',
    'GuestSession_reservation_owner',
  );
  await query(
    'UPDATE "GuestSession" SET "trialState" = $2, "reservedConversionId" = $3 WHERE id = $1',
    [owner.guestSessionId, 'reserved', id],
  );
  await query(
    `UPDATE "Conversion" SET status = 'failed', "failedAt" = now(), "errorCode" = 'INVALID_FILE' WHERE id = $1`,
    [id],
  );
  await query(
    `UPDATE "GuestSession" SET "trialState" = 'available', "reservedConversionId" = NULL WHERE id = $1`,
    [owner.guestSessionId],
  );
  const retry = await conversion(owner);
  assert.notEqual(retry, id);
});

test('guest success survives output deletion and cannot be reset or published twice', async () => {
  const owner = await guest();
  const id = await conversion(owner);
  await rejection(
    conversion(await guest(), { saveResult: true }),
    '23514',
    'Conversion_guest_not_saved',
  );
  const output = await temporaryOutput(owner);
  await complete(id, output);
  await query(
    `UPDATE "GuestSession" SET "trialState" = 'consumed', "consumedAt" = now() WHERE id = $1`,
    [owner.guestSessionId],
  );
  await query(
    `UPDATE "File" SET "deletedAt" = now(), "storageDeletionState" = 'pending' WHERE id = $1`,
    [output],
  );
  await rejection(
    query(
      `UPDATE "GuestSession" SET "trialState" = 'available', "consumedAt" = NULL WHERE id = $1`,
      [owner.guestSessionId],
    ),
    '23514',
    'GuestSession_consumed_immutable',
  );
  await rejection(
    complete(id, await temporaryOutput(owner)),
    '23514',
    'Conversion_terminal_immutable',
  );
  // Admission of a consumed guest is a future service check; publication has a DB backstop too.
  const second = await conversion(owner);
  await rejection(
    complete(second, await temporaryOutput(owner)),
    '23505',
    'Conversion_one_success_per_guest',
  );
  await rejection(
    query(`UPDATE "File" SET "expiresAt" = now() + interval '1 day' WHERE id = $1`, [output]),
    '23514',
    'File_identity_immutable',
  );
});

test('completed results cannot use another owner, wrong purpose or wrong format', async () => {
  const owner = await user();
  const id = await conversion(owner);
  await rejection(
    complete(id, await temporaryOutput(await user())),
    '23514',
    'Conversion_result_matches',
  );
  await rejection(complete(id, await file(owner)), '23514', 'Conversion_result_matches');
  await rejection(
    complete(
      id,
      await file(owner, {
        purpose: 'output',
        format: 'pdf',
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ),
    '23514',
    'Conversion_result_matches',
  );
  const output = await temporaryOutput(owner);
  await complete(id, output);
  await rejection(
    complete(await conversion(owner), output),
    '23505',
    'Conversion_resultFileId_key',
  );
});

for (const [sourceFormat, targetFormat] of [
  ['jpg', 'png'],
  ['png', 'jpg'],
  ['docx', 'pdf'],
]) {
  test(`schema accepts a complete ${sourceFormat} to ${targetFormat} lifecycle`, async () => {
    const owner = await user();
    const source = await file(owner, { format: sourceFormat });
    const id = await conversion(owner, { source, sourceFormat, targetFormat });
    const output = await file(owner, {
      format: targetFormat,
      purpose: 'output',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await complete(id, output);
    const result = await query('SELECT status, "resultFileId" FROM "Conversion" WHERE id = $1', [
      id,
    ]);
    assert.equal(result.rows[0].status, 'completed');
    assert.equal(result.rows[0].resultFileId, output);
  });
}

test('processing requires a complete lease and terminal status requires a result', async () => {
  const owner = await user();
  const id = await conversion(owner);
  await rejection(
    query(`UPDATE "Conversion" SET status = 'processing' WHERE id = $1`, [id]),
    '23514',
    'Conversion_status_shape',
  );
  await query(
    `UPDATE "Conversion" SET status = 'processing', attempts = 1, "processingVersion" = 1,
      "startedAt" = now(), "leaseToken" = gen_random_uuid(), "leaseExpiresAt" = now() + interval '1 minute' WHERE id = $1`,
    [id],
  );
  await rejection(
    query(
      `UPDATE "Conversion" SET status = 'completed', "completedAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL WHERE id = $1`,
      [id],
    ),
    '23514',
    'Conversion_status_shape',
  );
  await complete(id, await temporaryOutput(owner));
  await rejection(query('DELETE FROM "User" WHERE id = $1', [owner.userId]), '23001');
});

test('outbox deduplication and lease shape prevent inconsistent durable intents', async () => {
  const resource = randomUUID();
  const insert = () =>
    query(
      'INSERT INTO "BackgroundTask" (type, "resourceId", "deduplicationKey") VALUES ($1, $2, $3)',
      ['conversion_dispatch', resource, `dispatch:${resource}`],
    );
  await insert();
  await rejection(insert(), '23505');
  await rejection(
    query('UPDATE "BackgroundTask" SET "leaseToken" = gen_random_uuid() WHERE "resourceId" = $1', [
      resource,
    ]),
    '23514',
    'BackgroundTask_lease_shape',
  );
});
