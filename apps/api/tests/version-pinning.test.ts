import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createTestApp, publish, readSession, type TestApp } from './helpers.js';

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
    expect(session.funnel_id).toBe('workstyle-planner');
  });

  it('старая сессия продолжает работу на своей версии после публикации новой', async () => {
    const old = await createSession(ctx.app, '?variant=A');
    expect(old.funnel_version).toBe(1);
    expect(old.funnel.steps.some((step) => step.id === 'meeting_load')).toBe(false);

    const published = await publish(ctx.app, 'funnel-v2.json');
    expect(published.version).toBe(2);

    const reopened = await readSession(ctx.app, old.session_id);
    expect(reopened.funnel_version).toBe(1);
    expect(reopened.funnel.steps.map((step) => step.id)).toEqual(old.funnel.steps.map((step) => step.id));
    expect(reopened.funnel.steps.some((step) => step.id === 'meeting_load')).toBe(false);
  });

  it('новые сессии стартуют только на новой активной версии', async () => {
    const fresh = await createSession(ctx.app, '?variant=A');
    expect(fresh.funnel_version).toBe(2);
    expect(fresh.funnel.steps.some((step) => step.id === 'meeting_load')).toBe(true);
  });

  it('шаг, отсутствующий в закреплённой версии, не принимается', async () => {
    const rows = ctx.db
      .prepare('SELECT id FROM sessions WHERE funnel_version = 1 LIMIT 1')
      .all() as unknown as Array<{ id: string }>;
    const pinnedId = rows[0]?.id;
    expect(pinnedId).toBeDefined();

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${pinnedId}/answer`,
      payload: { step_id: 'meeting_load', value: 'low' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('TTL сессии берётся из конфига', async () => {
    const session = await createSession(ctx.app);
    const ttlHours = (Date.parse(session.expires_at) - Date.parse(session.created_at)) / 3_600_000;
    expect(ttlHours).toBe(72);
  });

  it('истёкшая сессия отдаёт 410, а не молча теряет данные', async () => {
    const session = await createSession(ctx.app);
    ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', session.session_id);

    const response = await ctx.app.inject({ method: 'GET', url: `/api/sessions/${session.session_id}` });
    expect(response.statusCode).toBe(410);
  });
});
