import {
  RESULT_STEP_ID,
  computeProgress,
  getNextStepId,
  normalizeAnswer,
  resolveVariant,
  validateAnswer,
  UTM_KEYS,
  type AnswerValue,
  type Answers,
  type ResolvedFunnel,
  type SessionView,
  type Utm,
  type VariantKey,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { badRequest, notFound } from '../errors.js';
import { assignVariant, newId } from './hash.js';
import { getActiveConfig, getConfig } from './versions.js';

export type SessionRow = {
  id: string;
  funnel_id: string;
  funnel_version: number;
  variant: VariantKey;
  variant_source: 'assigned' | 'override';
  current_step_id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string;
  last_seen_at: string;
  completed_at: string | null;
};

export const getSessionRow = (db: Database, sessionId: string): SessionRow | undefined =>
  db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;

export const requireSessionRow = (db: Database, sessionId: string): SessionRow => {
  const row = getSessionRow(db, sessionId);
  if (!row) throw notFound(`session "${sessionId}" not found`);
  return row;
};

export const getAnswers = (db: Database, sessionId: string): Answers => {
  const rows = db
    .prepare('SELECT step_id, value_json FROM session_answers WHERE session_id = ?')
    .all(sessionId) as unknown as Array<{ step_id: string; value_json: string }>;

  const answers: Answers = {};
  for (const row of rows) answers[row.step_id] = JSON.parse(row.value_json) as AnswerValue;
  return answers;
};

export const getResolvedFunnel = (db: Database, row: SessionRow): ResolvedFunnel =>
  resolveVariant(getConfig(db, row.funnel_version), row.variant);

const utmOf = (row: SessionRow): Utm => ({
  utm_source: row.utm_source,
  utm_medium: row.utm_medium,
  utm_campaign: row.utm_campaign,
  utm_content: row.utm_content,
  utm_term: row.utm_term,
});

export const buildSessionView = (db: Database, row: SessionRow): SessionView => {
  const funnel = getResolvedFunnel(db, row);
  const answers = getAnswers(db, row.id);
  const progress = computeProgress(funnel.steps, answers, row.current_step_id);

  return {
    session_id: row.id,
    funnel_version: row.funnel_version,
    variant: row.variant,
    variant_source: row.variant_source,
    created_at: row.created_at,
    completed_at: row.completed_at,
    current_step_id: row.current_step_id,
    path: progress.path,
    progress: { index: progress.index, total: progress.total, ratio: progress.ratio },
    answers,
    utm: utmOf(row),
    funnel,
  };
};

export const createSession = (
  db: Database,
  options: { utm?: Partial<Utm>; variantOverride?: VariantKey | null; salt: string; createdAt?: string },
): SessionRow => {
  const { version, config } = getActiveConfig(db);
  const sessionId = newId();
  const override = options.variantOverride ?? null;
  const hasOverride = override !== null && config.variants.some((variant) => variant.key === override);
  const variant = hasOverride ? (override as VariantKey) : assignVariant(config, sessionId, options.salt);
  const resolved = resolveVariant(config, variant);
  const firstStep = resolved.steps[0];
  if (!firstStep) throw badRequest('active funnel version has no steps for this variant');

  const now = options.createdAt ?? new Date().toISOString();
  const utm = options.utm ?? {};

  db.prepare(
    `INSERT INTO sessions (
       id, funnel_id, funnel_version, variant, variant_source, current_step_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       created_at, last_seen_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    sessionId,
    config.funnelId,
    version,
    variant,
    hasOverride ? 'override' : 'assigned',
    firstStep.id,
    utm.utm_source ?? null,
    utm.utm_medium ?? null,
    utm.utm_campaign ?? null,
    utm.utm_content ?? null,
    utm.utm_term ?? null,
    now,
    now,
  );

  return requireSessionRow(db, sessionId);
};

export const touchSession = (db: Database, sessionId: string, at?: string): void => {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(at ?? new Date().toISOString(), sessionId);
};

const setCurrentStep = (db: Database, sessionId: string, stepId: string, at: string): void => {
  const completedAt = stepId === RESULT_STEP_ID ? at : null;
  db.prepare(
    `UPDATE sessions
     SET current_step_id = ?, last_seen_at = ?, completed_at = COALESCE(completed_at, ?)
     WHERE id = ?`,
  ).run(stepId, at, completedAt, sessionId);
};

export const submitAnswer = (
  db: Database,
  row: SessionRow,
  stepId: string,
  value: AnswerValue | undefined,
  at?: string,
): SessionView => {
  const funnel = getResolvedFunnel(db, row);
  const step = funnel.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw badRequest(`step "${stepId}" does not exist in variant ${row.variant} of version ${row.funnel_version}`);

  const answersBefore = getAnswers(db, row.id);
  if (!computeProgress(funnel.steps, answersBefore, stepId).path.includes(stepId)) {
    throw badRequest(`step "${stepId}" is not reachable with the answers collected so far`);
  }

  const error = validateAnswer(step, value);
  if (error) throw badRequest(error, { step_id: stepId, field: 'value' });

  const normalized = normalizeAnswer(step, value);
  const now = at ?? new Date().toISOString();

  transaction(db, () => {
    db.prepare(
      `INSERT INTO session_answers (session_id, step_id, value_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (session_id, step_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).run(row.id, stepId, JSON.stringify(normalized), now);

    const answersAfter = { ...answersBefore, [stepId]: normalized };
    const path = computeProgress(funnel.steps, answersAfter, stepId).path;
    const reachable = new Set(path);

    for (const answeredStep of Object.keys(answersAfter)) {
      if (!reachable.has(answeredStep)) {
        db.prepare('DELETE FROM session_answers WHERE session_id = ? AND step_id = ?').run(row.id, answeredStep);
        delete answersAfter[answeredStep];
      }
    }

    setCurrentStep(db, row.id, getNextStepId(funnel.steps, stepId, answersAfter), now);
  });

  return buildSessionView(db, requireSessionRow(db, row.id));
};

export const goToStep = (db: Database, row: SessionRow, stepId: string, at?: string): SessionView => {
  const funnel = getResolvedFunnel(db, row);
  const answers = getAnswers(db, row.id);
  const path = computeProgress(funnel.steps, answers, row.current_step_id).path;

  if (stepId !== RESULT_STEP_ID && !path.includes(stepId)) {
    throw badRequest(`step "${stepId}" is not part of the current path`);
  }

  setCurrentStep(db, row.id, stepId, at ?? new Date().toISOString());
  return buildSessionView(db, requireSessionRow(db, row.id));
};

export const parseUtm = (query: Record<string, unknown>): Partial<Utm> => {
  const utm: Record<string, string | null> = {};
  for (const key of UTM_KEYS) {
    const value = query[key];
    utm[key] = typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 120) : null;
  }
  return utm as Partial<Utm>;
};
