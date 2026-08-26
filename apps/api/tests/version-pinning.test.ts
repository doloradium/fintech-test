import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionView } from '@funnel/shared';
import { createSession, createTestApp, json, publish, type TestApp } from './helpers.js';

describe('закрепление версии за сессией', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('новая сессия стартует на активной версии', async () => {
    const session = await createSession(ctx.app);
    expect(session.funnel_version).toBe(1);
  });

  it('старая сессия продолжает работу на своей версии после публикации новой', async () => {
    const old = await createSession(ctx.app);
    expect(old.funnel_version).toBe(1);

    const published = await publish(ctx.app, 'funnel.v2.json');
    expect(published.version).toBe(2);

    const reopened = json<SessionView>(
      (await ctx.app.inject({ method: 'GET', url: `/api/sessions/${old.session_id}` })).body,
    );

    expect(reopened.funnel_version).toBe(1);
    expect(reopened.funnel.steps.map((step) => step.id)).toEqual(old.funnel.steps.map((step) => step.id));
  });

  it('новые сессии стартуют только на новой активной версии', async () => {
    const fresh = await createSession(ctx.app);
    expect(fresh.funnel_version).toBe(2);
  });

  it('шаг, отсутствующий в закреплённой версии, не принимается', async () => {
    const session = await createSession(ctx.app);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/answer`,
      payload: { step_id: 'no_such_step', value: 'x' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('сессия версии 1 не знает про шаги, добавленные во второй версии', async () => {
    const rows = ctx.db
      .prepare('SELECT id FROM sessions WHERE funnel_version = 1 LIMIT 1')
      .all() as unknown as Array<{ id: string }>;
    const pinnedId = rows[0]?.id;
    expect(pinnedId).toBeDefined();

    const pinned = json<SessionView>(
      (await ctx.app.inject({ method: 'GET', url: `/api/sessions/${pinnedId}` })).body,
    );

    expect(pinned.funnel_version).toBe(1);
    expect(pinned.funnel.steps.some((step) => step.id === 'contact_time')).toBe(false);
  });
});
