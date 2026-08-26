import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionView, VersionsResponse } from '@funnel/shared';
import { activate, createSession, createTestApp, json, publish, walkToResult, type TestApp } from './helpers.js';

describe('публикация и откат версии', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const versions = async (): Promise<VersionsResponse> =>
    json<VersionsResponse>((await ctx.app.inject({ method: 'GET', url: '/api/admin/versions' })).body);

  it('публикация новой версии не требует передеплоя и сразу меняет активную', async () => {
    expect((await versions()).active_version).toBe(1);

    const published = await publish(ctx.app, 'funnel.v3.json');
    expect(published.version).toBe(2);

    const state = await versions();
    expect(state.active_version).toBe(2);
    expect(state.versions).toHaveLength(2);
    expect(state.activations[0]?.action).toBe('publish');
  });

  it('сессия, начатая до публикации, доживает до результата на старой версии', async () => {
    const before = await createSession(ctx.app);
    expect(before.funnel_version).toBe(2);

    await publish(ctx.app, 'funnel.v2.json');

    const finished = await walkToResult(ctx.app, before);
    expect(finished.funnel_version).toBe(2);
    expect(finished.current_step_id).toBe('@result');
    expect(finished.completed_at).not.toBeNull();
  });

  it('откат возвращает предыдущую версию и пишется в журнал как rollback', async () => {
    expect((await versions()).active_version).toBe(3);

    await activate(ctx.app, 1);

    const state = await versions();
    expect(state.active_version).toBe(1);
    expect(state.activations[0]?.action).toBe('rollback');

    const fresh = await createSession(ctx.app);
    expect(fresh.funnel_version).toBe(1);
  });

  it('аналитика по старым версиям переживает откат', async () => {
    const analytics = json<{ byVersion: Array<{ key: string; sessions: number }> }>(
      (await ctx.app.inject({ method: 'GET', url: '/api/admin/analytics' })).body,
    );

    expect(analytics.byVersion.map((row) => row.key).sort()).toEqual(['1', '2']);
  });

  it('вторая итерация добавляет ветку и убирает экран у варианта B', async () => {
    await activate(ctx.app, 2);

    const a = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=A', payload: {} })).body,
    );
    const b = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=B', payload: {} })).body,
    );

    expect(a.funnel.steps.some((step) => step.id === 'design_style')).toBe(true);
    expect(b.funnel.steps.some((step) => step.id === 'design_style')).toBe(true);
    expect(a.funnel.steps.some((step) => step.id === 'property_state')).toBe(true);
    expect(b.funnel.steps.some((step) => step.id === 'property_state')).toBe(false);
    expect(a.funnel.extraEvents).toContain('hint_opened');
  });

  it('новая ветка открывается только при подходящем ответе', async () => {
    const view = json<SessionView>(
      (await ctx.app.inject({ method: 'POST', url: '/api/sessions?variant=A', payload: {} })).body,
    );

    const withoutDesign = await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${view.session_id}/answer`,
      payload: { step_id: 'intro', value: true },
    });
    expect(withoutDesign.statusCode).toBe(200);

    let current = json<SessionView>(withoutDesign.body);
    current = json<SessionView>(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions/${view.session_id}/answer`,
          payload: { step_id: 'property_type', value: 'apartment' },
        })
      ).body,
    );
    current = json<SessionView>(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions/${view.session_id}/answer`,
          payload: { step_id: 'rooms', value: 2 },
        })
      ).body,
    );

    expect(current.current_step_id).toBe('works');
    expect(current.path).not.toContain('design_style');

    const withDesign = json<SessionView>(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions/${view.session_id}/answer`,
          payload: { step_id: 'works', value: ['walls', 'design'] },
        })
      ).body,
    );

    expect(withDesign.current_step_id).toBe('design_style');
    expect(withDesign.path).toContain('design_style');
  });
});
