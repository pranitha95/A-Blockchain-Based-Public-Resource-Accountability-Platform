/**
 * Provisions an initial platform administrator.
 * The password is read from ADMIN_PASSWORD (never from the command line, to keep it
 * out of shell history) and must satisfy the platform password policy.
 */
import { hash } from '@node-rs/argon2';
import { emailSchema, passwordSchema } from '@poi/shared';
import { closePool, withTransaction } from './pool.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../modules/audit/audit.service.js';
import { logger } from '../lib/logger.js';

function fail(message: string): never {
  logger.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

try {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const fullName = (process.argv[3] ?? process.env.ADMIN_NAME ?? '').trim();
  const password = process.env.ADMIN_PASSWORD ?? '';

  if (!email || !fullName || !password) {
    fail(
      'Usage: ADMIN_PASSWORD=... npm run create-admin -- <email> "<full name>" (or set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD). The password is never accepted as a CLI argument.',
    );
  }
  const emailResult = emailSchema.safeParse(email);
  if (!emailResult.success) fail(emailResult.error.issues[0]?.message ?? 'Invalid email address');
  const passwordResult = passwordSchema.safeParse(password);
  if (!passwordResult.success) fail(passwordResult.error.issues[0]?.message ?? 'Invalid password');
  if (fullName.length < 2 || fullName.length > 120) fail('Full name must be between 2 and 120 characters');

  const passwordHash = await hash(password, {
    // 2 is Argon2id.
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const userId = await withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.rowCount) fail('A user with that email already exists');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name, password_hash, role, status, is_demo)
       VALUES ($1,$2,$3,'ADMIN','ACTIVE',false) RETURNING id`,
      [email, fullName, passwordHash],
    );
    const id = inserted.rows[0]!.id;
    await appendAuditEvent(client, {
      actorId: null,
      actorRole: null,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'USER',
      entityId: id,
      summary: `Initial platform administrator provisioned through the create-admin command.`,
      metadata: { role: 'ADMIN', provisionedVia: 'create-admin-cli' },
    });
    return id;
  });

  logger.info({ email, fullName, userId }, 'Administrator account created');
} catch (error) {
  if (process.exitCode !== 1) logger.error({ err: error }, 'Failed to create administrator');
} finally {
  await closePool();
}
