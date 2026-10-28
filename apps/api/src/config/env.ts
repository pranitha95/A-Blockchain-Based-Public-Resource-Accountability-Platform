import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    });

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value.trim()));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: booleanFromString(false),
  COOKIE_SECURE: booleanFromString(false),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  RATE_LIMIT_ENABLED: booleanFromString(true),
  FILE_STORAGE_DIR: z.string().default('./var/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  DEMO_MODE: booleanFromString(false),
  SEED_DEMO: booleanFromString(false),
  SEED_DEMO_PASSWORD: optionalString,
  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  CHAIN_NAME: z.string().default('Sepolia'),
  RPC_URL: optionalString,
  CONTRACT_ADDRESS: optionalString,
  EXPLORER_BASE_URL: z.string().default('https://sepolia.etherscan.io'),
  ANCHOR_CONFIRMATIONS: z.coerce.number().int().min(1).max(64).default(2),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  SERVE_WEB: booleanFromString(false),
  WEB_DIST_PATH: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const env = parsed.data;
  if (env.CONTRACT_ADDRESS && !/^0x[0-9a-fA-F]{40}$/.test(env.CONTRACT_ADDRESS)) {
    throw new Error('CONTRACT_ADDRESS must be a 20-byte hex address');
  }
  if (env.RPC_URL && !/^https?:\/\//.test(env.RPC_URL)) {
    throw new Error('RPC_URL must be an http(s) URL');
  }
  if (env.NODE_ENV === 'production' && env.SEED_DEMO) {
    throw new Error('SEED_DEMO must not be enabled in production');
  }
  if (env.NODE_ENV === 'production' && env.DEMO_MODE) {
    // Demonstration data may exist in a showcase production deployment, but accounts
    // must not be seeded in production. DEMO_MODE only controls labels and is allowed.
  }
  cachedEnv = env;
  return env;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}

export function allowedWebOrigins(): string[] {
  return getEnv()
    .WEB_ORIGIN.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
