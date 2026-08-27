import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configDir, createSession, createTestApp, readSession, sendEvents, event, json, type TestApp } from './helpers.js';

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

  it('мусорный override не ломает создание сессии, а регистр нормализуется', async () => {
    const lowercase = await createSession(ctx.app, '?variant=b');
    expect(lowercase.variant).toBe('B');
    expect(lowercase.variant_source).toBe('override');

    const garbage = await createSession(ctx.app, '?variant=zzz');
    expect(['A', 'B']).toContain(garbage.variant);
    expect(garbage.variant_source).toBe('assigned');

    const empty = await createSession(ctx.app, '?variant=');
    expect(empty.variant_source).toBe('assigned');
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

  it('ключи вариантов берутся из конфига: работают не только A и B', async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, 'funnel-minimal.json'), 'utf8')) as {
      experiment: { variants: Record<string, unknown> };
    };
    const { A, B } = raw.experiment.variants as Record<string, unknown>;
    raw.experiment.variants = { control: A, turbo: B };

    const published = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/versions',
      payload: { config: raw },
    });
    expect(published.statusCode).toBe(201);

    const exact = await createSession(ctx.app, '?variant=turbo');
    expect(exact.variant).toBe('turbo');
    expect(exact.variant_source).toBe('override');
    expect(exact.funnel.variantKeys.sort()).toEqual(['control', 'turbo']);

    const uppercase = await createSession(ctx.app, '?variant=TURBO');
    expect(uppercase.variant).toBe('turbo');
    expect(uppercase.variant_source).toBe('override');

    const filtered = json<{
      overview: { sessions: number };
      byVariant: Array<{ key: string; label: string }>;
      available: { variants: string[] };
    }>((await ctx.app.inject({ method: 'GET', url: '/api/admin/analytics?version=2&variant=turbo' })).body);
    expect(filtered.overview.sessions).toBe(2);
    expect(filtered.byVariant.map((row) => row.key)).toEqual(['control', 'turbo']);
    expect(filtered.byVariant.find((row) => row.key === 'turbo')?.sessions).toBe(2);
    expect(filtered.byVariant.find((row) => row.key === 'control')?.sessions).toBe(0);
    expect(filtered.available.variants.sort()).toEqual(['control', 'turbo']);

    const union = json<{ available: { variants: string[] } }>(
      (await ctx.app.inject({ method: 'GET', url: '/api/admin/analytics' })).body,
    );
    expect(union.available.variants.sort()).toEqual(['A', 'B', 'control', 'turbo']);
  });

  it('UTM-метки чистятся от управляющих и невидимых символов', async () => {
    const dirty = encodeURIComponent('spring\u0000\u200b_sale\u001f');
    const session = await createSession(ctx.app, `?utm_campaign=${dirty}&utm_source=%20%20`);

    expect(session.utm.utm_campaign).toBe('spring_sale');
    expect(session.utm.utm_source).toBeNull();
  });

  it('вариант назначается детерминированно: одна и та же сессия даёт тот же бакет', async () => {
    const first = await createSession(ctx.app);
    const reread = await readSession(ctx.app, first.session_id);
    const row = ctx.db.prepare('SELECT variant FROM sessions WHERE id = ?').get(first.session_id) as { variant: string };

    expect(reread.variant).toBe(first.variant);
    expect(row.variant).toBe(first.variant);
  });
});
