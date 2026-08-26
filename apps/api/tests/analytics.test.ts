import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalyticsResponse, SessionView } from '@funnel/shared';
import { createTestApp, event, json, sendEvents, walkToResult, type TestApp } from './helpers.js';

const A_PATH = ['intro', 'property_type', 'rooms', 'works', 'property_state', 'budget', 'timeline'];

describe('расчёт аналитических показателей', () => {
  let ctx: TestApp;
  let full: SessionView;
  let mid: SessionView;
  let back: SessionView;
  let variantB: SessionView;

  const start = async (variant: 'A' | 'B', campaign: string): Promise<SessionView> =>
    json<SessionView>(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions?variant=${variant}&utm_campaign=${campaign}&utm_source=test`,
          payload: {},
        })
      ).body,
    );

  const analytics = async (query = ''): Promise<AnalyticsResponse> =>
    json<AnalyticsResponse>((await ctx.app.inject({ method: 'GET', url: `/api/admin/analytics${query}` })).body);

  beforeAll(async () => {
    ctx = await createTestApp();

    full = await start('A', 'spring');
    mid = await start('A', 'spring');
    back = await start('A', 'winter');
    variantB = await start('B', 'winter');

    await walkToResult(ctx.app, full);
    const fullBatch = [
      ...A_PATH.flatMap((stepId, index) => [
        event(full.session_id, 'step_viewed', stepId, { seq: index * 2 + 1 }),
        event(full.session_id, 'step_completed', stepId, { seq: index * 2 + 2 }),
      ]),
      event(full.session_id, 'result_viewed', '@result', { seq: 100 }),
      event(full.session_id, 'cta_clicked', '@result', { seq: 101 }),
      event(full.session_id, 'step_viewed', 'intro', { seq: 102 }),
      event(full.session_id, 'step_viewed', 'intro', { seq: 103 }),
    ];
    await sendEvents(ctx.app, fullBatch);
    await sendEvents(ctx.app, fullBatch);

    await sendEvents(ctx.app, [
      event(mid.session_id, 'step_viewed', 'intro', { seq: 1 }),
      event(mid.session_id, 'step_completed', 'intro', { seq: 2 }),
      event(mid.session_id, 'step_viewed', 'property_type', { seq: 3 }),
    ]);

    await sendEvents(ctx.app, [
      event(back.session_id, 'step_viewed', 'intro', { seq: 1 }),
      event(back.session_id, 'step_completed', 'intro', { seq: 2 }),
      event(back.session_id, 'step_viewed', 'property_type', { seq: 3 }),
      event(back.session_id, 'back_clicked', 'property_type', { seq: 4 }),
      event(back.session_id, 'step_viewed', 'intro', { seq: 5 }),
      event(back.session_id, 'step_completed', 'property_type', { seq: 6 }),
      event(back.session_id, 'step_viewed', 'rooms', { seq: 7 }),
    ]);

    const bPath = variantB.funnel.steps.slice(0, 3).map((step) => step.id);
    const bBatch = [
      ...bPath.map((stepId, index) => event(variantB.session_id, 'step_viewed', stepId, { seq: index + 1 })),
      event(variantB.session_id, 'result_viewed', '@result', { seq: 50 }),
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
    const events = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ? AND type = 'step_viewed' AND step_id = 'intro'")
      .get(full.session_id) as { total: number };

    expect(Number(events.total)).toBe(3);

    const data = await analytics('?variant=A');
    expect(data.steps.find((step) => step.stepId === 'intro')?.entered).toBe(3);
  });

  it('отвал и конверсия между шагами учитывают возвраты назад', async () => {
    const data = await analytics('?variant=A');

    const propertyType = data.steps.find((step) => step.stepId === 'property_type');
    expect(propertyType?.entered).toBe(3);
    expect(propertyType?.continued).toBe(2);
    expect(propertyType?.dropoff).toBe(1);
    expect(propertyType?.backClicks).toBe(1);

    const rooms = data.steps.find((step) => step.stepId === 'rooms');
    expect(rooms?.entered).toBe(2);
    expect(rooms?.continued).toBe(1);
  });

  it('события, пришедшие не по порядку, обрабатываются корректно', async () => {
    const data = await analytics('?variant=B');

    expect(data.overview.sessions).toBe(1);
    expect(data.overview.reachedResult).toBe(1);
    expect(data.dataQuality.outOfOrderEvents).toBeGreaterThan(0);
  });

  it('фильтр по UTM campaign сужает выборку', async () => {
    const spring = await analytics('?utm_campaign=spring');
    const winter = await analytics('?utm_campaign=winter');

    expect(spring.overview.sessions).toBe(2);
    expect(winter.overview.sessions).toBe(2);
    expect(spring.overview.ctaClicks).toBe(1);
    expect(winter.overview.ctaClicks).toBe(0);
  });

  it('сравнение вариантов и версий доступно в одном ответе', async () => {
    const data = await analytics();

    expect(data.byVariant.map((row) => row.key).sort()).toEqual(['A', 'B']);
    expect(data.byVersion.map((row) => row.key)).toEqual(['1']);
    expect(data.overview.sessions).toBe(4);
  });
});
