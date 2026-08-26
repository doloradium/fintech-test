import {
  STEP_SCOPED_EVENT_NAMES,
  eventInputSchema,
  resolveVariant,
  type EventDefinition,
  type EventInput,
  type EventRejection,
  type IngestResult,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { getConfig } from './versions.js';
import { getSessionRow, type SessionRow } from './sessions.js';

const STEP_SCOPED = new Set<string>(STEP_SCOPED_EVENT_NAMES);
const MAX_STRING = 200;

type VersionCatalog = {
  definitions: Map<string, EventDefinition>;
  privacy: { storeRawAnswers: boolean; allowAnswerKinds: boolean };
};

const catalogFor = (db: Database, row: SessionRow, cache: Map<number, VersionCatalog>): VersionCatalog => {
  const cached = cache.get(row.funnel_version);
  if (cached) return cached;

  const config = getConfig(db, row.funnel_version);
  const catalog: VersionCatalog = {
    definitions: new Map(config.events.allowed.map((event) => [event.name, event])),
    privacy: config.events.privacy,
  };
  cache.set(row.funnel_version, catalog);
  return catalog;
};

const stepIdsFor = (db: Database, row: SessionRow, cache: Map<string, Set<string>>): Set<string> => {
  const key = `${row.funnel_version}:${row.variant}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const ids = new Set(resolveVariant(getConfig(db, row.funnel_version), row.variant).steps.map((step) => step.id));
  cache.set(key, ids);
  return ids;
};

export const sanitizeProperties = (
  definition: EventDefinition,
  privacy: { storeRawAnswers: boolean; allowAnswerKinds: boolean },
  properties: Record<string, unknown> | null | undefined,
): string | null => {
  if (!properties) return null;

  const allowed = new Set(definition.properties);
  const output: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) continue;
    if (key === 'answer_kind' && !privacy.allowAnswerKinds) continue;

    if (value === null) output[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else if (typeof value === 'boolean') output[key] = value;
    else if (typeof value === 'string') output[key] = value.slice(0, MAX_STRING);
  }

  return Object.keys(output).length === 0 ? null : JSON.stringify(output);
};

type PreparedEvent = {
  input: EventInput;
  session: SessionRow;
  propertiesJson: string | null;
  resultId: string | null;
};

export const ingestEvents = (
  db: Database,
  rawEvents: unknown[],
  options: { serverTimestamp?: string } = {},
): IngestResult => {
  const rejected: EventRejection[] = [];
  const prepared: PreparedEvent[] = [];
  const seenInBatch = new Set<string>();
  let duplicatesInBatch = 0;

  const sessionCache = new Map<string, SessionRow | null>();
  const stepCache = new Map<string, Set<string>>();
  const catalogCache = new Map<number, VersionCatalog>();

  rawEvents.forEach((raw, index) => {
    const parsed = eventInputSchema.safeParse(raw);
    if (!parsed.success) {
      const candidate =
        typeof raw === 'object' && raw !== null && typeof (raw as { event_id?: unknown }).event_id === 'string'
          ? (raw as { event_id: string }).event_id
          : null;
      rejected.push({
        index,
        event_id: candidate,
        reason: `validation_failed: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`)
          .join('; ')}`,
      });
      return;
    }

    const input = parsed.data;

    if (seenInBatch.has(input.event_id)) {
      duplicatesInBatch += 1;
      return;
    }

    if (!sessionCache.has(input.session_id)) {
      sessionCache.set(input.session_id, getSessionRow(db, input.session_id) ?? null);
    }
    const session = sessionCache.get(input.session_id) ?? null;
    if (!session) {
      rejected.push({ index, event_id: input.event_id, reason: 'unknown_session' });
      return;
    }

    const catalog = catalogFor(db, session, catalogCache);
    const definition = catalog.definitions.get(input.name);
    if (!definition) {
      rejected.push({
        index,
        event_id: input.event_id,
        reason: `unknown_event_name: "${input.name}" is not declared by funnel version ${session.funnel_version}`,
      });
      return;
    }

    const stepId = input.step_id ?? null;

    if (STEP_SCOPED.has(input.name) && !stepId) {
      rejected.push({ index, event_id: input.event_id, reason: `missing_step_id: event "${input.name}" requires step_id` });
      return;
    }

    if (stepId && !stepIdsFor(db, session, stepCache).has(stepId)) {
      rejected.push({
        index,
        event_id: input.event_id,
        reason: `unknown_step: "${stepId}" is not part of variant ${session.variant} of version ${session.funnel_version}`,
      });
      return;
    }

    const rawResultId = input.properties?.result_id;

    seenInBatch.add(input.event_id);
    prepared.push({
      input,
      session,
      propertiesJson: sanitizeProperties(definition, catalog.privacy, input.properties),
      resultId: typeof rawResultId === 'string' ? rawResultId.slice(0, 64) : null,
    });
  });

  const serverTimestamp = options.serverTimestamp ?? new Date().toISOString();
  let accepted = 0;
  let duplicates = duplicatesInBatch;

  if (prepared.length > 0) {
    transaction(db, () => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO events (
           event_id, session_id, name, funnel_id, funnel_version, experiment_id, variant, step_id, result_id, seq,
           client_timestamp, server_timestamp, utm_source, utm_medium, utm_campaign, utm_content, utm_term, properties_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const item of prepared) {
        const result = insert.run(
          item.input.event_id,
          item.input.session_id,
          item.input.name,
          item.session.funnel_id,
          item.session.funnel_version,
          item.session.experiment_id,
          item.session.variant,
          item.input.step_id ?? null,
          item.resultId,
          item.input.seq ?? null,
          item.input.client_timestamp,
          serverTimestamp,
          item.session.utm_source,
          item.session.utm_medium,
          item.session.utm_campaign,
          item.session.utm_content,
          item.session.utm_term,
          item.propertiesJson,
        );

        if (Number(result.changes) > 0) accepted += 1;
        else duplicates += 1;
      }

      const touch = db.prepare('UPDATE sessions SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?');
      for (const sessionId of new Set(prepared.map((item) => item.input.session_id))) {
        touch.run(serverTimestamp, sessionId);
      }
    });
  }

  db.prepare(
    'UPDATE ingest_stats SET accepted = accepted + ?, duplicates = duplicates + ?, rejected = rejected + ? WHERE id = 1',
  ).run(accepted, duplicates, rejected.length);

  return { received: rawEvents.length, accepted, duplicates, rejected };
};
