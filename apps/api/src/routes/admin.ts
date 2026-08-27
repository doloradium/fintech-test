import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VersionsResponse } from '@funnel/shared';
import type { Database } from '../db/database.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { computeAnalytics } from '../domain/analytics.js';
import {
  activateVersion,
  getActiveVersion,
  getConfig,
  listActivations,
  listBundledConfigs,
  listVersions,
  publishConfig,
  readBundledConfig,
} from '../domain/versions.js';

const publishBody = z
  .object({
    config: z.unknown().nullish(),
    file: z.string().min(1).nullish(),
    notes: z.string().max(500).nullish(),
    actor: z.string().max(80).nullish(),
    activate: z.boolean().nullish(),
  })
  .refine((body) => body.config != null || body.file != null, {
    message: 'provide either "config" (inline JSON) or "file" (a bundled config file name)',
  });

const analyticsQuery = z.object({
  version: z.coerce.number().int().positive().nullish(),
  variant: z.enum(['A', 'B']).nullish(),
  utm_campaign: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
});

export const registerAdminRoutes = (
  app: FastifyInstance,
  deps: { db: Database; configDir: string; adminToken: string | null },
): void => {
  const { db, configDir, adminToken } = deps;

  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  const expectedDigest = adminToken ? digest(adminToken) : null;

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/admin')) return;
    if (!expectedDigest) return;
    const provided = request.headers['x-admin-token'];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expectedDigest)) {
      throw new HttpError(401, 'admin token is missing or invalid');
    }
  });

  app.get('/api/admin/versions', async (): Promise<VersionsResponse> => ({
    active_version: getActiveVersion(db),
    versions: listVersions(db),
    activations: listActivations(db),
    bundled_configs: listBundledConfigs(configDir),
  }));

  app.get('/api/admin/versions/:version/config', async (request) => {
    const { version } = request.params as { version: string };
    return getConfig(db, Number(version));
  });

  app.post('/api/admin/versions', async (request, reply) => {
    const body = publishBody.parse(request.body ?? {});
    const input = body.config != null ? body.config : readBundledConfig(configDir, body.file as string);
    if (input == null) throw badRequest(`config "${body.file}" could not be read as JSON`);

    const { version } = publishConfig(db, input, {
      actor: body.actor ?? 'admin',
      notes: body.notes ?? null,
      source: body.file ?? 'inline',
      activate: body.activate !== false,
    });

    reply.code(201);
    return { version, active_version: getActiveVersion(db) };
  });

  app.post('/api/admin/versions/:version/activate', async (request) => {
    const { version } = request.params as { version: string };
    const body = z.object({ note: z.string().max(500).nullish(), actor: z.string().max(80).nullish() }).parse(
      request.body ?? {},
    );

    const activated = activateVersion(db, Number(version), {
      actor: body.actor ?? 'admin',
      note: body.note ?? null,
    });

    return { active_version: activated };
  });

  app.get('/api/admin/events/:eventId', async (request) => {
    const { eventId } = request.params as { eventId: string };
    const row = db.prepare('SELECT * FROM events WHERE event_id = ?').get(eventId);
    if (!row) throw notFound(`event "${eventId}" not found`);
    return row;
  });

  app.get('/api/admin/analytics', async (request) => {
    const query = analyticsQuery.parse(request.query ?? {});
    return computeAnalytics(db, {
      version: query.version ?? null,
      variant: query.variant ?? null,
      utm_campaign: query.utm_campaign ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    });
  });
};
