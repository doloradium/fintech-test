import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SessionView } from '@funnel/shared';
import { openDatabase, type Database } from '../src/db/database.js';
import { bootstrapFunnel } from '../src/bootstrap.js';
import { buildServer } from '../src/server.js';

export const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'configs');

export type TestApp = {
  app: FastifyInstance;
  db: Database;
  close: () => Promise<void>;
};

export const createTestApp = async (bootstrapFile = 'funnel.v1.json'): Promise<TestApp> => {
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
  body: Record<string, unknown> = {},
): Promise<SessionView> => {
  const response = await app.inject({ method: 'POST', url: '/api/sessions', payload: body });
  if (response.statusCode !== 201) throw new Error(`session creation failed: ${response.body}`);
  return json<SessionView>(response.body);
};

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

export const defaultAnswerFor = (view: SessionView, stepId: string): unknown => {
  const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`step "${stepId}" is missing from the resolved funnel`);
  if (step.type === 'info') return true;
  if (step.type === 'single_select') return step.options[0]?.value;
  if (step.type === 'multi_select') return [step.options[0]?.value];
  return step.min ?? 1;
};

export const walkToResult = async (app: FastifyInstance, start: SessionView): Promise<SessionView> => {
  let view = start;
  let guard = 0;

  while (view.current_step_id !== '@result' && guard < 40) {
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
  type: string,
  stepId: string | null = null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  event_id: randomUUID(),
  session_id: sessionId,
  type,
  step_id: stepId,
  client_ts: new Date().toISOString(),
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
