import fs from 'node:fs';
import path from 'node:path';
import {
  parseFunnelConfig,
  safeParseFunnelConfig,
  type ActivationEntry,
  type FunnelConfig,
  type VersionSummary,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { checksum } from './hash.js';

type VersionRow = {
  version: number;
  funnel_id: string;
  title: string;
  schema_version: string;
  config_json: string;
  checksum: string;
  source: string | null;
  notes: string | null;
  created_at: string;
};

const configCache = new WeakMap<Database, Map<number, FunnelConfig>>();

const cacheFor = (db: Database): Map<number, FunnelConfig> => {
  const existing = configCache.get(db);
  if (existing) return existing;
  const created = new Map<number, FunnelConfig>();
  configCache.set(db, created);
  return created;
};

export class VersionNotFoundError extends Error {}

export const getConfig = (db: Database, version: number): FunnelConfig => {
  const cache = cacheFor(db);
  const cached = cache.get(version);
  if (cached) return cached;

  const row = db.prepare('SELECT * FROM funnel_versions WHERE version = ?').get(version) as VersionRow | undefined;
  if (!row) throw new VersionNotFoundError(`funnel version ${version} not found`);

  const config = parseFunnelConfig(JSON.parse(row.config_json));
  cache.set(version, config);
  return config;
};

export const getActiveVersion = (db: Database): number | null => {
  const row = db.prepare('SELECT active_version FROM funnel_state WHERE id = 1').get() as
    | { active_version: number | null }
    | undefined;
  return row?.active_version ?? null;
};

export const getActiveConfig = (db: Database): { version: number; config: FunnelConfig } => {
  const version = getActiveVersion(db);
  if (version === null) throw new VersionNotFoundError('no active funnel version is published');
  return { version, config: getConfig(db, version) };
};

export const listVersionRows = (db: Database): VersionRow[] =>
  db.prepare('SELECT * FROM funnel_versions ORDER BY version DESC').all() as unknown as VersionRow[];

const logActivation = (
  db: Database,
  version: number,
  action: ActivationEntry['action'],
  actor: string,
  note: string | null,
): void => {
  db.prepare(
    'INSERT INTO version_activations (version, action, actor, note, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(version, action, actor, note, new Date().toISOString());
};

const setActive = (db: Database, version: number): void => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO funnel_state (id, active_version, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET active_version = excluded.active_version, updated_at = excluded.updated_at`,
  ).run(version, now);
};

export const publishConfig = (
  db: Database,
  input: unknown,
  options: { actor?: string; notes?: string | null; source?: string | null; activate?: boolean } = {},
): { version: number; config: FunnelConfig } => {
  const config = parseFunnelConfig(input);
  const actor = options.actor ?? 'admin';
  const activate = options.activate !== false;

  return transaction(db, () => {
    const maxRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS max_version FROM funnel_versions').get() as {
      max_version: number;
    };
    const version = Number(maxRow.max_version) + 1;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO funnel_versions (version, funnel_id, title, schema_version, config_json, checksum, source, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      version,
      config.funnelId,
      config.title,
      config.schemaVersion,
      JSON.stringify(config),
      checksum(config),
      options.source ?? null,
      options.notes ?? null,
      now,
    );

    cacheFor(db).set(version, config);

    if (activate) {
      setActive(db, version);
      logActivation(db, version, 'publish', actor, options.notes ?? null);
    }

    return { version, config };
  });
};

export const activateVersion = (
  db: Database,
  version: number,
  options: { actor?: string; note?: string | null } = {},
): number => {
  const exists = db.prepare('SELECT version FROM funnel_versions WHERE version = ?').get(version);
  if (!exists) throw new VersionNotFoundError(`funnel version ${version} not found`);

  const current = getActiveVersion(db);
  const action: ActivationEntry['action'] = current !== null && version < current ? 'rollback' : 'activate';

  transaction(db, () => {
    setActive(db, version);
    logActivation(db, version, action, options.actor ?? 'admin', options.note ?? null);
  });

  return version;
};

export const listActivations = (db: Database, limit = 50): ActivationEntry[] =>
  db
    .prepare('SELECT id, version, action, actor, note, created_at FROM version_activations ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as ActivationEntry[];

export const listVersions = (db: Database): VersionSummary[] => {
  const active = getActiveVersion(db);
  const sessionCounts = new Map<number, number>();

  for (const row of db
    .prepare('SELECT funnel_version, COUNT(*) AS total FROM sessions GROUP BY funnel_version')
    .all() as unknown as Array<{ funnel_version: number; total: number }>) {
    sessionCounts.set(Number(row.funnel_version), Number(row.total));
  }

  return listVersionRows(db).map((row) => {
    const config = getConfig(db, row.version);
    return {
      version: row.version,
      funnel_id: row.funnel_id,
      title: row.title,
      schema_version: row.schema_version,
      checksum: row.checksum,
      notes: row.notes,
      created_at: row.created_at,
      is_active: row.version === active,
      steps: Object.keys(config.steps).length,
      sessions: sessionCounts.get(row.version) ?? 0,
      results: Object.keys(config.results).length,
      events: config.events.allowed.map((event) => event.name),
      override_query_param: config.experiment.overrideQueryParam,
      variants: Object.entries(config.experiment.variants).map(([key, variant]) => ({
        key,
        steps: variant.stepSequence.length,
        weight: variant.weight,
      })),
    };
  });
};

export type BundledConfig = {
  file: string;
  title: string;
  funnel_id: string;
  steps: number;
};

export const listBundledConfigs = (configDir: string): BundledConfig[] => {
  if (!fs.existsSync(configDir)) return [];

  return fs
    .readdirSync(configDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const parsed = safeParseFunnelConfig(readJson(path.join(configDir, file)));
      if (!parsed.success) return [];
      return [
        {
          file,
          title: parsed.data.title,
          funnel_id: parsed.data.funnelId,
          steps: Object.keys(parsed.data.steps).length,
        },
      ];
    });
};

export const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

export const readBundledConfig = (configDir: string, file: string): unknown => {
  const safeName = path.basename(file);
  if (!safeName.endsWith('.json')) throw new Error('only .json config files can be published');
  const target = path.join(configDir, safeName);
  if (!fs.existsSync(target)) throw new Error(`config file "${safeName}" not found`);
  return readJson(target);
};
