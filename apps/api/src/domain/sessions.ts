import {
  computeProgress,
  firstStepId,
  getNextStepId,
  getPreviousStepId,
  normalizeAnswer,
  resolveResultId,
  resolveVariant,
  resultStepId,
  UTM_KEYS,
  validateAnswer,
  visibleStepIds,
  type AnswerValue,
  type Answers,
  type ResolvedFunnel,
  type SessionView,
  type Utm,
  type VariantKey,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { assignVariant, newId } from './hash.js';
import { getActiveConfig, getConfig } from './versions.js';

export type SessionRow = {
  id: string;
  funnel_id: string;
  funnel_version: number;
  experiment_id: string;
  variant: VariantKey;
  variant_source: 'assigned' | 'override';
  current_step_id: string;
  result_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  completed_at: string | null;
};

export const getSessionRow = (db: Database, sessionId: string): SessionRow | undefined =>
  db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;

export const requireSessionRow = (db: Database, sessionId: string): SessionRow => {
  const row = getSessionRow(db, sessionId);
  if (!row) throw notFound(`session "${sessionId}" not found`);
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new HttpError(410, `session "${sessionId}" has expired`, { expires_at: row.expires_at });
  }
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
  const progress = computeProgress(funnel, answers, row.current_step_id);
  const onResult = funnel.steps.find((step) => step.id === row.current_step_id)?.type === 'result';

  return {
    session_id: row.id,
    funnel_id: row.funnel_id,
    funnel_version: row.funnel_version,
    experiment_id: row.experiment_id,
    variant: row.variant,
    variant_source: row.variant_source,
    created_at: row.created_at,
    expires_at: row.expires_at,
    completed_at: row.completed_at,
    current_step_id: row.current_step_id,
    result_id: onResult ? (row.result_id ?? resolveResultId(funnel, answers)) : null,
    path: progress.path,
    progress: { index: progress.index, total: progress.total, ratio: progress.ratio, counted: progress.counted },
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
  const hasOverride = override !== null && Object.hasOwn(config.experiment.variants, override);
  const variant = hasOverride ? (override as VariantKey) : assignVariant(config, sessionId, options.salt);
  const funnel = resolveVariant(config, variant);

  const now = options.createdAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + config.session.ttlHours * 3_600_000).toISOString();
  const utm = options.utm ?? {};

  db.prepare(
    `INSERT INTO sessions (
       id, funnel_id, funnel_version, experiment_id, variant, variant_source, current_step_id, result_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       created_at, last_seen_at, expires_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    sessionId,
    config.funnelId,
    version,
    config.experiment.id,
    variant,
    hasOverride ? 'override' : 'assigned',
    firstStepId(funnel),
    utm.utm_source ?? null,
    utm.utm_medium ?? null,
    utm.utm_campaign ?? null,
    utm.utm_content ?? null,
    utm.utm_term ?? null,
    now,
    now,
    expiresAt,
  );

  const row = getSessionRow(db, sessionId);
  if (!row) throw new Error('session insert did not produce a row');
  return row;
};

const setCurrentStep = (
  db: Database,
  row: SessionRow,
  funnel: ResolvedFunnel,
  answers: Answers,
  stepId: string,
  at: string,
): void => {
  const isResult = funnel.steps.find((step) => step.id === stepId)?.type === 'result';
  const resultId = isResult ? resolveResultId(funnel, answers) : null;

  db.prepare(
    `UPDATE sessions
     SET current_step_id = ?, result_id = COALESCE(?, result_id), last_seen_at = ?, completed_at = COALESCE(completed_at, ?)
     WHERE id = ?`,
  ).run(stepId, resultId, at, isResult ? at : null, row.id);
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
  if (!step) {
    throw badRequest(`step "${stepId}" does not exist in variant ${row.variant} of version ${row.funnel_version}`);
  }

  const answersBefore = getAnswers(db, row.id);
  if (!visibleStepIds(funnel, answersBefore).includes(stepId)) {
    throw badRequest(`step "${stepId}" is not visible with the answers collected so far`);
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

    const answersAfter: Answers = { ...answersBefore, [stepId]: normalized };
    const reachable = new Set(visibleStepIds(funnel, answersAfter));

    for (const answeredStep of Object.keys(answersAfter)) {
      if (!reachable.has(answeredStep)) {
        db.prepare('DELETE FROM session_answers WHERE session_id = ? AND step_id = ?').run(row.id, answeredStep);
        delete answersAfter[answeredStep];
      }
    }

    setCurrentStep(db, row, funnel, answersAfter, getNextStepId(funnel, stepId, answersAfter), now);
  });

  return buildSessionView(db, requireSessionRow(db, row.id));
};

export const goToStep = (db: Database, row: SessionRow, stepId: string, at?: string): SessionView => {
  const funnel = getResolvedFunnel(db, row);
  const answers = getAnswers(db, row.id);
  const path = visibleStepIds(funnel, answers);
  const targetIndex = path.indexOf(stepId);

  if (targetIndex === -1) {
    throw badRequest(`step "${stepId}" is not part of the current path`);
  }

  const firstUnanswered = path.findIndex((candidate) => answers[candidate] === undefined);
  const frontier = firstUnanswered === -1 ? path.length - 1 : firstUnanswered;

  if (targetIndex > frontier) {
    throw badRequest(`step "${stepId}" is ahead of the furthest answered step`, {
      step_id: stepId,
      frontier_step_id: path[frontier],
    });
  }

  setCurrentStep(db, row, funnel, answers, stepId, at ?? new Date().toISOString());
  return buildSessionView(db, requireSessionRow(db, row.id));
};

export const previousStepOf = (db: Database, row: SessionRow): string | null => {
  const funnel = getResolvedFunnel(db, row);
  return getPreviousStepId(funnel, row.current_step_id, getAnswers(db, row.id));
};

export const resultStepOf = (db: Database, row: SessionRow): string | null =>
  resultStepId(getResolvedFunnel(db, row));

export const parseUtm = (query: Record<string, unknown>): Partial<Utm> => {
  const utm: Record<string, string | null> = {};
  for (const key of UTM_KEYS) {
    const value = query[key];
    if (typeof value !== 'string') {
      utm[key] = null;
      continue;
    }
    const cleaned = value
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '')
      .trim()
      .slice(0, 120);
    utm[key] = cleaned !== '' ? cleaned : null;
  }
  return utm as Partial<Utm>;
};
