import path from 'node:path';
import type { Database } from './db/database.js';
import { getActiveVersion, publishConfig, readJson } from './domain/versions.js';

export const bootstrapFunnel = (
  db: Database,
  options: { configDir: string; file: string },
): { version: number } | null => {
  if (getActiveVersion(db) !== null) return null;

  const target = path.join(options.configDir, options.file);
  const input = readJson(target);
  if (input == null) return null;

  const { version } = publishConfig(db, input, {
    actor: 'bootstrap',
    notes: 'Первая публикация при старте сервера',
    source: options.file,
    activate: true,
  });

  return { version };
};
