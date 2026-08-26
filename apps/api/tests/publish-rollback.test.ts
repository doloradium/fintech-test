import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionView, VersionsResponse } from '@funnel/shared';
import {
  activate,
  answer,
  createSession,
  createTestApp,
  defaultAnswerFor,
  isResultStep,
  json,
  publish,
  stepOf,
  walkToResult,
  type TestApp,
} from './helpers.js';

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

    const published = await publish(ctx.app, 'funnel-v2.json');
    expect(published.version).toBe(2);

    const state = await versions();
    expect(state.active_version).toBe(2);
    expect(state.versions).toHaveLength(2);
    expect(state.activations[0]?.action).toBe('publish');
  });

  it('сессия, начатая до публикации, доживает до результата на старой версии', async () => {
    const before = await createSession(ctx.app, '?variant=A');
    expect(before.funnel_version).toBe(2);

    await publish(ctx.app, 'funnel-v1.json');

    const finished = await walkToResult(ctx.app, before);
    expect(finished.funnel_version).toBe(2);
    expect(finished.completed_at).not.toBeNull();
    expect(finished.result_id).toBeTruthy();
  });

  it('откат возвращает предыдущую версию и пишется в журнал как rollback', async () => {
    expect((await versions()).active_version).toBe(3);

    await activate(ctx.app, 1);

    const state = await versions();
    expect(state.active_version).toBe(1);
    expect(state.activations[0]?.action).toBe('rollback');
    expect((await createSession(ctx.app)).funnel_version).toBe(1);
  });

  it('аналитика по прежним версиям переживает откат', async () => {
    const analytics = json<{ byVersion: Array<{ key: string }> }>(
      (await ctx.app.inject({ method: 'GET', url: '/api/admin/analytics' })).body,
    );

    expect(analytics.byVersion.map((row) => row.key).sort()).toEqual(['1', '2']);
  });

  it('вторая итерация добавляет ветку и убирает экран у варианта B', async () => {
    await activate(ctx.app, 2);

    const a = await createSession(ctx.app, '?variant=A');
    const b = await createSession(ctx.app, '?variant=B');

    expect(a.funnel.steps.some((step) => step.id === 'meeting_load')).toBe(true);
    expect(b.funnel.steps.some((step) => step.id === 'meeting_load')).toBe(true);
    expect(a.funnel.steps.some((step) => step.id === 'tool_count')).toBe(true);
    expect(b.funnel.steps.some((step) => step.id === 'tool_count')).toBe(false);
    expect(a.funnel.events.allowed.map((entry) => entry.name)).toContain('recommendation_expanded');
  });

  it('новая условная ветка открывается только при подходящем ответе', async () => {
    let view = await createSession(ctx.app, '?variant=A');
    view = await answer(ctx.app, view.session_id, 'intro', true);
    view = await answer(ctx.app, view.session_id, 'team_size', 12);
    view = await answer(ctx.app, view.session_id, 'work_mode', 'remote');
    view = await answer(ctx.app, view.session_id, 'priorities', ['speed']);
    view = await answer(ctx.app, view.session_id, 'timezone_span', 'same');

    expect(view.path).not.toContain('office_days');
    expect(view.current_step_id).toBe('async_maturity');

    const withoutBranch = await answer(ctx.app, view.session_id, 'async_maturity', 'high');
    expect(withoutBranch.path).not.toContain('meeting_load');
    expect(withoutBranch.current_step_id).toBe('tool_count');

    const withBranch = await answer(ctx.app, view.session_id, 'async_maturity', 'low');
    expect(withBranch.path).toContain('meeting_load');
    expect(withBranch.current_step_id).toBe('meeting_load');
  });

  it('условная ветка учитывается в знаменателе прогресса, пока не исключена ответом', async () => {
    let view = await createSession(ctx.app, '?variant=A');
    const optimisticTotal = view.progress.total;

    view = await answer(ctx.app, view.session_id, 'intro', true);
    view = await answer(ctx.app, view.session_id, 'team_size', 8);

    const hybrid = await answer(ctx.app, view.session_id, 'work_mode', 'hybrid');
    expect(hybrid.path).toContain('office_days');
    expect(hybrid.progress.total).toBe(optimisticTotal);

    const remote = await answer(ctx.app, view.session_id, 'work_mode', 'remote');
    expect(remote.path).not.toContain('office_days');
    expect(remote.progress.total).toBe(optimisticTotal - 1);
  });

  it('прогресс не уезжает назад при движении вперёд', async () => {
    for (const [variant, mode] of [
      ['A', 'remote'],
      ['A', 'hybrid'],
      ['B', 'hybrid'],
    ] as Array<[string, string]>) {
      let view = await createSession(ctx.app, `?variant=${variant}`);
      const seen: number[] = [];
      let guard = 0;

      while (!isResultStep(view) && guard < 20) {
        guard += 1;
        seen.push(view.progress.ratio);
        const step = stepOf(view, view.current_step_id);
        const value = step.id === 'work_mode' ? mode : defaultAnswerFor(view, step.id);
        view = await answer(ctx.app, view.session_id, step.id, value);
      }

      seen.forEach((ratio, index) => {
        if (index === 0) return;
        expect(ratio, `${variant}/${mode} на шаге ${index}`).toBeGreaterThanOrEqual(seen[index - 1] ?? 0);
      });
    }
  });

  it('возврат назад показывает тот же прогресс, что и первый визит на шаг', async () => {
    let view = await createSession(ctx.app, '?variant=A');
    view = await answer(ctx.app, view.session_id, 'intro', true);
    view = await answer(ctx.app, view.session_id, 'team_size', 10);

    const onWorkMode = { ...view.progress };
    expect(view.current_step_id).toBe('work_mode');

    view = await answer(ctx.app, view.session_id, 'work_mode', 'hybrid');
    expect(view.progress.ratio).toBeGreaterThan(onWorkMode.ratio);

    const back = json<SessionView>(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions/${view.session_id}/navigate`,
          payload: { step_id: 'work_mode' },
        })
      ).body,
    );

    expect(back.progress.index).toBe(onWorkMode.index);
    expect(back.progress.total).toBe(onWorkMode.total);
    expect(back.progress.ratio).toBe(onWorkMode.ratio);
  });

  it('служебные экраны не участвуют в нумерации шагов', async () => {
    const view = await createSession(ctx.app, '?variant=A');
    expect(stepOf(view, view.current_step_id).type).toBe('info');
    expect(view.progress.counted).toBe(false);

    const next = await answer(ctx.app, view.session_id, view.current_step_id, true);
    expect(next.progress.counted).toBe(true);
    expect(next.progress.index).toBe(0);
  });
});
