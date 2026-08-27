import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '..', '..', '..');

const fromEnv = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

export const appConfig = {
  host: fromEnv('HOST', '0.0.0.0'),
  port: Number(fromEnv('PORT', '3000')),
  dataDir: path.resolve(repoRoot, fromEnv('DATA_DIR', 'data')),
  databaseFile: fromEnv('DATABASE_FILE', ''),
  configDir: path.resolve(repoRoot, fromEnv('CONFIG_DIR', 'configs')),
  webDist: path.resolve(repoRoot, fromEnv('WEB_DIST', 'apps/web/dist')),
  bootstrapConfig: fromEnv('BOOTSTRAP_CONFIG', 'funnel-v1.json'),
  adminToken: process.env.ADMIN_TOKEN ?? null,
  rateLimitMax: Number(fromEnv('RATE_LIMIT_MAX', '3000')),
  experimentSalt: fromEnv('EXPERIMENT_SALT', 'funnel-runtime'),
  serveWeb: fromEnv('SERVE_WEB', 'true') !== 'false',
};

export const resolveDatabaseFile = (): string =>
  appConfig.databaseFile !== ''
    ? path.resolve(repoRoot, appConfig.databaseFile)
    : path.join(appConfig.dataDir, 'funnel.sqlite');
