import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createTestApp, readSession, sendEvents, event, type TestApp } from './helpers.js';

describe('стабильность A/B-варианта', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('вариант назначается на backend и не меняется при повторном чтении сессии', async () => {
    const session = await createSession(ctx.app);
    expect(['A', 'B']).toContain(session.variant);
    expect(session.variant_source).toBe('assigned');

    for (let i = 0; i < 5; i += 1) {
      expect((await readSession(ctx.app, session.session_id)).variant).toBe(session.variant);
    }
  });

  it('override через query-параметр фиксируется в сессии', async () => {
    const forced = await createSession(ctx.app, '?variant=B');
    expect(forced.variant).toBe('B');
    expect(forced.variant_source).toBe('override');
    expect((await readSession(ctx.app, forced.session_id)).variant).toBe('B');
  });

  it('распределение задействует оба варианта', async () => {
    const variants = new Set<string>();
    for (let i = 0; i < 40; i += 1) variants.add((await createSession(ctx.app)).variant);
    expect([...variants].sort()).toEqual(['A', 'B']);
  });

  it('варианты меняют порядок шагов, тексты и экран результата', async () => {
    const a = await createSession(ctx.app, '?variant=A');
    const b = await createSession(ctx.app, '?variant=B');

    expect(a.funnel.steps.map((step) => step.id)).not.toEqual(b.funnel.steps.map((step) => step.id));
    expect(a.funnel.steps[0]?.content.title).not.toBe(b.funnel.steps[0]?.content.title);
    expect(a.funnel.results.async_native?.cta.label).not.toBe(b.funnel.results.async_native?.cta.label);
    expect(a.funnel.results.async_native?.title).not.toBe(b.funnel.results.async_native?.title);
  });

  it('все события несут версию воронки, вариант и id эксперимента', async () => {
    const session = await createSession(ctx.app);
    await sendEvents(ctx.app, [event(session.session_id, 'session_started')]);

    const stored = ctx.db
      .prepare('SELECT funnel_id, funnel_version, experiment_id, variant FROM events WHERE session_id = ?')
      .all(session.session_id) as unknown as Array<{
      funnel_id: string;
      funnel_version: number;
      experiment_id: string;
      variant: string;
    }>;

    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      funnel_id: session.funnel_id,
      funnel_version: session.funnel_version,
      experiment_id: session.experiment_id,
      variant: session.variant,
    });
  });

  it('вариант назначается детерминированно: одна и та же сессия даёт тот же бакет', async () => {
    const first = await createSession(ctx.app);
    const reread = await readSession(ctx.app, first.session_id);
    const row = ctx.db.prepare('SELECT variant FROM sessions WHERE id = ?').get(first.session_id) as { variant: string };

    expect(reread.variant).toBe(first.variant);
    expect(row.variant).toBe(first.variant);
  });
});
