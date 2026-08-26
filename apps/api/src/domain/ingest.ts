import {
  CORE_EVENT_TYPES,
  RESULT_STEP_ID,
  STEP_SCOPED_EVENT_TYPES,
  eventInputSchema,
  resolveVariant,
  type EventInput,
  type EventRejection,
  type IngestResult,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { getConfig } from './versions.js';
import { getSessionRow, type SessionRow } from './sessions.js';

const CORE = new Set<string>(CORE_EVENT_TYPES);
const STEP_SCOPED = new Set<string>(STEP_SCOPED_EVENT_TYPES);

const ANSWER_PROP_ALLOWLIST = new Set(['value_type', 'option_count', 'value_bucket', 'attempt', 'is_valid']);

const MAX_PROPS = 20;
const MAX_STRING = 200;

export const sanitizeProps = (type: string, props: Record<string, unknown> | null | undefined): string | null => {
  if (!props) return null;

  const output: Record<string, string | number | boolean | null> = {};
  let count = 0;

  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_PROPS) break;
    if (type === 'answer_submitted' && !ANSWER_PROP_ALLOWLIST.has(key)) continue;
    if (value === null) {
      output[key] = null;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value;
    } else if (typeof value === 'boolean') {
      output[key] = value;
    } else if (typeof value === 'string') {
      output[key] = value.slice(0, MAX_STRING);
    } else {
      continue;
    }
    count += 1;
  }

  return count === 0 ? null : JSON.stringify(output);
};

const stepIdsFor = (db: Database, row: SessionRow, cache: Map<string, Set<string>>): Set<string> => {
  const key = `${row.funnel_version}:${row.variant}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const resolved = resolveVariant(getConfig(db, row.funnel_version), row.variant);
  const ids = new Set(resolved.steps.map((step) => step.id));
  ids.add(RESULT_STEP_ID);
  cache.set(key, ids);
  return ids;
};

const allowedTypesFor = (db: Database, row: SessionRow, cache: Map<number, Set<string>>): Set<string> => {
  const cached = cache.get(row.funnel_version);
  if (cached) return cached;

  const config = getConfig(db, row.funnel_version);
  const types = new Set<string>([...CORE, ...config.extraEvents]);
  cache.set(row.funnel_version, types);
  return types;
};

type PreparedEvent = {
  input: EventInput;
  session: SessionRow;
  propsJson: string | null;
};

export const ingestEvents = (
  db: Database,
  rawEvents: unknown[],
  options: { serverTs?: string } = {},
): IngestResult => {
  const rejected: EventRejection[] = [];
  const prepared: PreparedEvent[] = [];
  const seenInBatch = new Set<string>();
  let duplicatesInBatch = 0;

  const sessionCache = new Map<string, SessionRow | null>();
  const stepCache = new Map<string, Set<string>>();
  const typeCache = new Map<number, Set<string>>();

  rawEvents.forEach((raw, index) => {
    const parsed = eventInputSchema.safeParse(raw);
    if (!parsed.success) {
      const idCandidate =
        typeof raw === 'object' && raw !== null && typeof (raw as { event_id?: unknown }).event_id === 'string'
          ? (raw as { event_id: string }).event_id
          : null;
      rejected.push({
        index,
        event_id: idCandidate,
        reason: `validation_failed: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`).join('; ')}`,
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

    if (!allowedTypesFor(db, session, typeCache).has(input.type)) {
      rejected.push({
        index,
        event_id: input.event_id,
        reason: `unknown_event_type: "${input.type}" is not declared for funnel version ${session.funnel_version}`,
      });
      return;
    }

    const stepId = input.step_id ?? null;

    if (STEP_SCOPED.has(input.type) && !stepId) {
      rejected.push({ index, event_id: input.event_id, reason: `missing_step_id: event type "${input.type}" requires step_id` });
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

    seenInBatch.add(input.event_id);
    prepared.push({ input, session, propsJson: sanitizeProps(input.type, input.props) });
  });

  const serverTs = options.serverTs ?? new Date().toISOString();
  let accepted = 0;
  let duplicates = duplicatesInBatch;

  if (prepared.length > 0) {
    transaction(db, () => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO events (
           event_id, session_id, type, funnel_version, variant, step_id, seq,
           client_ts, server_ts, utm_source, utm_medium, utm_campaign, utm_content, utm_term, props_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const item of prepared) {
        const result = insert.run(
          item.input.event_id,
          item.input.session_id,
          item.input.type,
          item.session.funnel_version,
          item.session.variant,
          item.input.step_id ?? null,
          item.input.seq ?? null,
          item.input.client_ts,
          serverTs,
          item.session.utm_source,
          item.session.utm_medium,
          item.session.utm_campaign,
          item.session.utm_content,
          item.session.utm_term,
          item.propsJson,
        );

        if (Number(result.changes) > 0) accepted += 1;
        else duplicates += 1;
      }

      const touch = db.prepare('UPDATE sessions SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?');
      for (const sessionId of new Set(prepared.map((item) => item.input.session_id))) {
        touch.run(serverTs, sessionId);
      }
    });
  }

  db.prepare(
    'UPDATE ingest_stats SET accepted = accepted + ?, duplicates = duplicates + ?, rejected = rejected + ? WHERE id = 1',
  ).run(accepted, duplicates, rejected.length);

  return {
    received: rawEvents.length,
    accepted,
    duplicates,
    rejected,
  };
};
