import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SessionView, Step } from '@funnel/shared';
import { openDatabase, type Database } from '../src/db/database.js';
import { bootstrapFunnel } from '../src/bootstrap.js';
import { buildServer } from '../src/server.js';

export const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'configs');

export type TestApp = {
  app: FastifyInstance;
  db: Database;
  close: () => Promise<void>;
};

export const createTestApp = async (bootstrapFile = 'funnel-v1.json'): Promise<TestApp> => {
  const db = openDatabase(':memory:');
  bootstrapFunnel(db, { configDir, file: bootstrapFile });

  const app = await buildServer({
    db,
    configDir,
    adminToken: null,
    experimentSalt: 'test-salt',
    webDist: '',
    serveWeb: false,
  });

  return {
    app,
    db,
    close: async () => {
      await app.close();
      db.close();
    },
  };
};

export const json = <T>(payload: string): T => JSON.parse(payload) as T;

export const createSession = async (
  app: FastifyInstance,
  query = '',
  body: Record<string, unknown> = {},
): Promise<SessionView> => {
  const response = await app.inject({ method: 'POST', url: `/api/sessions${query}`, payload: body });
  if (response.statusCode !== 201) throw new Error(`session creation failed: ${response.body}`);
  return json<SessionView>(response.body);
};

export const readSession = async (app: FastifyInstance, sessionId: string): Promise<SessionView> =>
  json<SessionView>((await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })).body);

export const answer = async (
  app: FastifyInstance,
  sessionId: string,
  stepId: string,
  value: unknown,
): Promise<SessionView> => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/answer`,
    payload: { step_id: stepId, value },
  });
  if (response.statusCode !== 200) throw new Error(`answer failed on "${stepId}": ${response.body}`);
  return json<SessionView>(response.body);
};

export const stepOf = (view: SessionView, stepId: string): Step => {
  const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`step "${stepId}" is missing from the resolved funnel`);
  return step;
};

export const defaultAnswerFor = (view: SessionView, stepId: string, optionIndex = 0): unknown => {
  const step = stepOf(view, stepId);
  const options = step.input?.options ?? [];

  if (step.type === 'info' || step.type === 'result') return true;
  if (step.type === 'single-select') return options[Math.min(optionIndex, options.length - 1)]?.value;
  if (step.type === 'multi-select') return [options[0]?.value];
  return step.input?.min ?? 1;
};

export const isResultStep = (view: SessionView): boolean =>
  view.funnel.steps.find((step) => step.id === view.current_step_id)?.type === 'result';

export const walkToResult = async (app: FastifyInstance, start: SessionView): Promise<SessionView> => {
  let view = start;
  let guard = 0;

  while (!isResultStep(view) && guard < 40) {
    guard += 1;
    view = await answer(app, view.session_id, view.current_step_id, defaultAnswerFor(view, view.current_step_id));
  }

  return view;
};

export const sendEvents = async (
  app: FastifyInstance,
  events: Array<Record<string, unknown>>,
): Promise<{ received: number; accepted: number; duplicates: number; rejected: unknown[] }> => {
  const response = await app.inject({ method: 'POST', url: '/api/events', payload: { events } });
  return json(response.body);
};

export const event = (
  sessionId: string,
  name: string,
  stepId: string | null = null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  event_id: randomUUID(),
  session_id: sessionId,
  name,
  step_id: stepId,
  client_timestamp: new Date().toISOString(),
  ...extra,
});

export const publish = async (
  app: FastifyInstance,
  file: string,
  activate = true,
): Promise<{ version: number }> => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/versions',
    payload: { file, activate },
  });
  if (response.statusCode !== 201) throw new Error(`publish failed: ${response.body}`);
  return json(response.body);
};

export const activate = async (app: FastifyInstance, version: number): Promise<void> => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/admin/versions/${version}/activate`,
    payload: {},
  });
  if (response.statusCode !== 200) throw new Error(`activate failed: ${response.body}`);
};
