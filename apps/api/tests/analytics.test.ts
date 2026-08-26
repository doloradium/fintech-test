import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalyticsResponse, SessionView } from '@funnel/shared';
import { createSession, createTestApp, event, json, sendEvents, walkToResult, type TestApp } from './helpers.js';

describe('расчёт аналитических показателей', () => {
  let ctx: TestApp;
  let full: SessionView;
  let mid: SessionView;
  let back: SessionView;
  let variantB: SessionView;

  const analytics = async (query = ''): Promise<AnalyticsResponse> =>
    json<AnalyticsResponse>((await ctx.app.inject({ method: 'GET', url: `/api/admin/analytics${query}` })).body);

  beforeAll(async () => {
    ctx = await createTestApp();

    full = await createSession(ctx.app, '?variant=A&utm_campaign=search');
    mid = await createSession(ctx.app, '?variant=A&utm_campaign=search');
    back = await createSession(ctx.app, '?variant=A&utm_campaign=social');
    variantB = await createSession(ctx.app, '?variant=B&utm_campaign=social');

    const finished = await walkToResult(ctx.app, full);
    const walked = finished.path.filter((stepId) => stepId !== 'result');

    const fullBatch = [
      ...walked.flatMap((stepId, index) => [
        event(full.session_id, 'step_viewed', stepId, { seq: index * 2 + 1 }),
        event(full.session_id, 'step_completed', stepId, { seq: index * 2 + 2 }),
      ]),
      event(full.session_id, 'result_viewed', 'result', { seq: 100, properties: { result_id: finished.result_id } }),
      event(full.session_id, 'cta_clicked', 'result', { seq: 101, properties: { result_id: finished.result_id, action: 'expand_recommendation' } }),
      event(full.session_id, 'step_viewed', 'intro', { seq: 102 }),
      event(full.session_id, 'step_viewed', 'intro', { seq: 103 }),
    ];

    await sendEvents(ctx.app, fullBatch);
    await sendEvents(ctx.app, fullBatch);

    await sendEvents(ctx.app, [
      event(mid.session_id, 'step_viewed', 'intro', { seq: 1 }),
      event(mid.session_id, 'step_completed', 'intro', { seq: 2 }),
      event(mid.session_id, 'step_viewed', 'team_size', { seq: 3 }),
    ]);

    await sendEvents(ctx.app, [
      event(back.session_id, 'step_viewed', 'intro', { seq: 1 }),
      event(back.session_id, 'step_completed', 'intro', { seq: 2 }),
      event(back.session_id, 'step_viewed', 'team_size', { seq: 3 }),
      event(back.session_id, 'back_clicked', 'team_size', { seq: 4, properties: { destination_step_id: 'intro' } }),
      event(back.session_id, 'step_viewed', 'intro', { seq: 5 }),
      event(back.session_id, 'step_completed', 'team_size', { seq: 6 }),
      event(back.session_id, 'step_viewed', 'work_mode', { seq: 7 }),
    ]);

    const finishedB = await walkToResult(ctx.app, variantB);
    const bBatch = [
      ...finishedB.path
        .filter((stepId) => stepId !== 'result')
        .slice(0, 3)
        .map((stepId, index) => event(variantB.session_id, 'step_viewed', stepId, { seq: index + 1 })),
      event(variantB.session_id, 'result_viewed', 'result', { seq: 50, properties: { result_id: finishedB.result_id } }),
    ];
    await sendEvents(ctx.app, [...bBatch].reverse());
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('показатели считаются по уникальным сессиям, а не по количеству событий', async () => {
    const data = await analytics('?variant=A');

    expect(data.overview.sessions).toBe(3);
    expect(data.overview.reachedResult).toBe(1);
    expect(data.overview.ctaClicks).toBe(1);
    expect(data.overview.ctaCtr).toBeCloseTo(1 / 3, 5);

    const intro = data.steps.find((step) => step.stepId === 'intro');
    expect(intro?.entered).toBe(3);
    expect(intro?.completed).toBe(3);
  });

  it('повторные просмотры и дубли событий не увеличивают конверсию', async () => {
    const stored = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ? AND name = 'step_viewed' AND step_id = 'intro'")
      .get(full.session_id) as { total: number };
    expect(Number(stored.total)).toBe(3);

    const data = await analytics('?variant=A');
    expect(data.steps.find((step) => step.stepId === 'intro')?.entered).toBe(3);
  });

  it('отвал и конверсия между шагами учитывают возвраты назад', async () => {
    const data = await analytics('?variant=A');

    const teamSize = data.steps.find((step) => step.stepId === 'team_size');
    expect(teamSize?.entered).toBe(3);
    expect(teamSize?.continued).toBe(2);
    expect(teamSize?.dropoff).toBe(1);
    expect(teamSize?.backClicks).toBe(1);

    const workMode = data.steps.find((step) => step.stepId === 'work_mode');
    expect(workMode?.entered).toBe(2);
    expect(workMode?.continued).toBe(1);
  });

  it('события, пришедшие не по порядку, обрабатываются корректно', async () => {
    const data = await analytics('?variant=B');

    expect(data.overview.sessions).toBe(1);
    expect(data.overview.reachedResult).toBe(1);
    expect(data.dataQuality.outOfOrderEvents).toBeGreaterThan(0);
  });

  it('фильтр по UTM campaign сужает выборку', async () => {
    const search = await analytics('?utm_campaign=search');
    const social = await analytics('?utm_campaign=social');

    expect(search.overview.sessions).toBe(2);
    expect(social.overview.sessions).toBe(2);
    expect(search.overview.ctaClicks).toBe(1);
    expect(social.overview.ctaClicks).toBe(0);
  });

  it('сравнение вариантов, версий и экранов результата доступно в одном ответе', async () => {
    const data = await analytics();

    expect(data.byVariant.map((row) => row.key).sort()).toEqual(['A', 'B']);
    expect(data.byVersion.map((row) => row.key)).toEqual(['1']);
    expect(data.overview.sessions).toBe(4);
    expect(data.byResult.length).toBeGreaterThan(0);
    expect(data.byResult.reduce((sum, row) => sum + row.sessions, 0)).toBe(2);
  });

  it('результат выбирается правилами resultRules', async () => {
    const remote = await createSession(ctx.app, '?variant=A');
    let view = remote;
    for (const [stepId, value] of [
      ['intro', true],
      ['team_size', 10],
      ['work_mode', 'remote'],
      ['priorities', ['speed']],
      ['timezone_span', 'global'],
      ['async_maturity', 'medium'],
      ['tool_count', 5],
    ] as Array<[string, unknown]>) {
      view = json<SessionView>(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/sessions/${remote.session_id}/answer`,
            payload: { step_id: stepId, value },
          })
        ).body,
      );
    }

    expect(view.result_id).toBe('async_native');

    const office = await createSession(ctx.app, '?variant=A');
    let officeView = office;
    for (const [stepId, value] of [
      ['intro', true],
      ['team_size', 10],
      ['work_mode', 'office'],
      ['priorities', ['culture']],
      ['timezone_span', 'same'],
      ['office_days', 4],
      ['async_maturity', 'medium'],
      ['tool_count', 5],
    ] as Array<[string, unknown]>) {
      officeView = json<SessionView>(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/sessions/${office.session_id}/answer`,
            payload: { step_id: stepId, value },
          })
        ).body,
      );
    }

    expect(officeView.result_id).toBe('office_core');
  });
});
