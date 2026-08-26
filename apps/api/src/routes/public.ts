import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eventBatchSchema, utmSchema } from '@funnel/shared';
import type { Database } from '../db/database.js';
import { badRequest, notFound } from '../errors.js';
import { ingestEvents } from '../domain/ingest.js';
import {
  buildSessionView,
  createSession,
  goToStep,
  parseUtm,
  requireSessionRow,
  submitAnswer,
} from '../domain/sessions.js';

const createSessionBody = z
  .object({
    variant: z.enum(['A', 'B']).nullish(),
    utm: utmSchema.partial().nullish(),
  })
  .nullish();

const answerBody = z.object({
  step_id: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
});

const navigateBody = z.object({
  step_id: z.string().min(1),
});

export const registerPublicRoutes = (
  app: FastifyInstance,
  deps: { db: Database; experimentSalt: string },
): void => {
  const { db, experimentSalt } = deps;

  app.get('/api/health', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  app.post('/api/sessions', async (request, reply) => {
    const body = createSessionBody.parse(request.body ?? null);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const queryVariant = typeof query.variant === 'string' ? query.variant.toUpperCase() : null;
    const override =
      body?.variant ?? (queryVariant === 'A' || queryVariant === 'B' ? (queryVariant as 'A' | 'B') : null);

    const utm = { ...parseUtm(query), ...(body?.utm ?? {}) };
    const row = createSession(db, { utm, variantOverride: override, salt: experimentSalt });

    reply.code(201);
    return buildSessionView(db, row);
  });

  app.get('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    return buildSessionView(db, requireSessionRow(db, id));
  });

  app.post('/api/sessions/:id/answer', async (request) => {
    const { id } = request.params as { id: string };
    const body = answerBody.parse(request.body);
    const row = requireSessionRow(db, id);
    return submitAnswer(db, row, body.step_id, body.value);
  });

  app.post('/api/sessions/:id/navigate', async (request) => {
    const { id } = request.params as { id: string };
    const body = navigateBody.parse(request.body);
    const row = requireSessionRow(db, id);
    return goToStep(db, row, body.step_id);
  });

  app.post('/api/events', async (request, reply) => {
    const raw = request.body;
    if (raw === null || typeof raw !== 'object') throw badRequest('request body must be an object or a batch');

    const events = Array.isArray((raw as { events?: unknown }).events)
      ? eventBatchSchema.parse(raw).events
      : [raw];

    const result = ingestEvents(db, events);
    reply.code(result.accepted > 0 || result.duplicates > 0 ? 200 : 202);
    return result;
  });

  app.get('/api/events/:eventId', async (request) => {
    const { eventId } = request.params as { eventId: string };
    const row = db.prepare('SELECT * FROM events WHERE event_id = ?').get(eventId);
    if (!row) throw notFound(`event "${eventId}" not found`);
    return row;
  });
};
