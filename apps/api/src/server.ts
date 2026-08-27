import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Database } from './db/database.js';
import { HttpError } from './errors.js';
import { VersionNotFoundError } from './domain/versions.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerPublicRoutes } from './routes/public.js';

export type ServerOptions = {
  db: Database;
  configDir: string;
  adminToken: string | null;
  experimentSalt: string;
  webDist: string;
  serveWeb: boolean;
  logger?: boolean;
  rateLimitMax?: number | null;
};

export const buildServer = async (options: ServerOptions): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });

  if (options.rateLimitMax) {
    await app.register(rateLimit, {
      max: options.rateLimitMax,
      timeWindow: '1 minute',
      allowList: ['127.0.0.1'],
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message, details: error.details });
    }
    if (error instanceof VersionNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_failed',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: error instanceof Error ? error.message : 'request_failed' });
    }

    app.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  registerPublicRoutes(app, { db: options.db, experimentSalt: options.experimentSalt });
  registerAdminRoutes(app, { db: options.db, configDir: options.configDir, adminToken: options.adminToken });

  const indexFile = path.join(options.webDist, 'index.html');
  const canServeWeb = options.serveWeb && fs.existsSync(indexFile);

  if (canServeWeb) {
    await app.register(fastifyStatic, { root: options.webDist, index: ['index.html'] });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));
  }

  return app;
};
