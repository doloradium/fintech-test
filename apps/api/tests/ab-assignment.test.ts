import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionView } from '@funnel/shared';
import { createSession, createTestApp, json, type TestApp } from './helpers.js';

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
      const reread = json<SessionView>(
        (await ctx.app.inject({ method: 'GET', url: `/api/sessions/${session.session_id}` })).body,
      );
      expect(reread.variant).toBe(session.variant);
    }
  });

  it('override через query-параметр фиксируется в сессии', async () => {
    const forced = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=B', payload: {} })).body,
    );

    expect(forced.variant).toBe('B');
    expect(forced.variant_source).toBe('override');

    const reread = json<SessionView>(
      (await ctx.app.inject({ method: 'GET', url: `/api/sessions/${forced.session_id}` })).body,
    );
    expect(reread.variant).toBe('B');
  });

  it('распределение задействует оба варианта', async () => {
    const variants = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      variants.add((await createSession(ctx.app)).variant);
    }
    expect([...variants].sort()).toEqual(['A', 'B']);
  });

  it('варианты отдают разный порядок шагов и разный экран результата', async () => {
    const a = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=A', payload: {} })).body,
    );
    const b = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=B', payload: {} })).body,
    );

    expect(a.funnel.steps.map((step) => step.id)).not.toEqual(b.funnel.steps.map((step) => step.id));
    expect(a.funnel.result.cta.label).not.toBe(b.funnel.result.cta.label);
  });

  it('все события сессии несут версию воронки и вариант', async () => {
    const session = await createSession(ctx.app);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        events: [
          {
            event_id: `${session.session_id}-started`,
            session_id: session.session_id,
            type: 'session_started',
            client_ts: new Date().toISOString(),
          },
        ],
      },
    });

    const stored = ctx.db
      .prepare('SELECT funnel_version, variant FROM events WHERE session_id = ?')
      .all(session.session_id) as unknown as Array<{ funnel_version: number; variant: string }>;

    expect(stored).toHaveLength(1);
    expect(stored[0]?.funnel_version).toBe(session.funnel_version);
    expect(stored[0]?.variant).toBe(session.variant);
  });
});
