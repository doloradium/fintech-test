import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createTestApp, event, sendEvents, type TestApp } from './helpers.js';

describe('дедупликация событий', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const countEvents = (sessionId: string): number =>
    Number(
      (ctx.db.prepare('SELECT COUNT(*) AS total FROM events WHERE session_id = ?').get(sessionId) as { total: number })
        .total,
    );

  it('повторная отправка одного event_id не создаёт дубль', async () => {
    const session = await createSession(ctx.app);
    const payload = event(session.session_id, 'session_started');

    const first = await sendEvents(ctx.app, [payload]);
    const second = await sendEvents(ctx.app, [payload]);

    expect(first.accepted).toBe(1);
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(countEvents(session.session_id)).toBe(1);
  });

  it('повторная отправка целой пачки после timeout безопасна', async () => {
    const session = await createSession(ctx.app);
    const batch = [
      event(session.session_id, 'session_started'),
      event(session.session_id, 'step_viewed', 'intro'),
      event(session.session_id, 'step_completed', 'intro'),
    ];

    const first = await sendEvents(ctx.app, batch);
    const retry = await sendEvents(ctx.app, batch);

    expect(first.accepted).toBe(3);
    expect(retry.accepted).toBe(0);
    expect(retry.duplicates).toBe(3);
    expect(countEvents(session.session_id)).toBe(3);
  });

  it('дубль внутри одной пачки схлопывается', async () => {
    const session = await createSession(ctx.app);
    const single = event(session.session_id, 'step_viewed', 'intro');

    const result = await sendEvents(ctx.app, [single, single, single]);

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(2);
    expect(countEvents(session.session_id)).toBe(1);
  });

  it('некорректное событие не ломает обработку всей пачки', async () => {
    const session = await createSession(ctx.app);

    const result = await sendEvents(ctx.app, [
      event(session.session_id, 'step_viewed', 'intro'),
      { event_id: 'short', session_id: session.session_id, name: 'step_viewed', client_timestamp: 'не дата' },
      event('00000000-0000-0000-0000-000000000000', 'step_viewed', 'intro'),
      event(session.session_id, 'step_viewed'),
      event(session.session_id, 'recommendation_expanded', 'result'),
      event(session.session_id, 'step_viewed', 'no_such_step'),
      event(session.session_id, 'step_completed', 'intro'),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected.map((item) => (item as { reason: string }).reason.split(':')[0])).toEqual([
      'validation_failed',
      'unknown_session',
      'missing_step_id',
      'unknown_event_name',
      'unknown_step',
    ]);
    expect(countEvents(session.session_id)).toBe(2);
  });

  it('событие принимается только если объявлено в конфиге своей версии', async () => {
    const session = await createSession(ctx.app);

    const beforePublish = await sendEvents(ctx.app, [
      event(session.session_id, 'recommendation_expanded', 'result', { properties: { result_id: 'balanced' } }),
    ]);
    expect(beforePublish.accepted).toBe(0);

    await ctx.app.inject({ method: 'POST', url: '/api/admin/versions', payload: { file: 'funnel-v2.json' } });

    const onNewVersion = await createSession(ctx.app);
    const afterPublish = await sendEvents(ctx.app, [
      event(onNewVersion.session_id, 'recommendation_expanded', 'result', { properties: { result_id: 'balanced' } }),
    ]);
    expect(afterPublish.accepted).toBe(1);
  });

  it('в событие попадают только свойства, объявленные конфигом', async () => {
    const session = await createSession(ctx.app);

    await sendEvents(ctx.app, [
      event(session.session_id, 'answer_submitted', 'team_size', {
        properties: { answer_kind: 'number', value: 42, raw_answer: 'секрет', email: 'a@b.c' },
      }),
    ]);

    const row = ctx.db
      .prepare("SELECT properties_json FROM events WHERE session_id = ? AND name = 'answer_submitted'")
      .get(session.session_id) as { properties_json: string | null };

    expect(row.properties_json).toBe('{"answer_kind":"number"}');
  });

  it('сырые ответы хранятся отдельно от событий', async () => {
    const session = await createSession(ctx.app, '?variant=A');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/answer`,
      payload: { step_id: 'intro', value: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/answer`,
      payload: { step_id: 'team_size', value: 42 },
    });

    const answers = ctx.db
      .prepare('SELECT value_json FROM session_answers WHERE session_id = ? AND step_id = ?')
      .get(session.session_id, 'team_size') as { value_json: string };
    expect(answers.value_json).toBe('42');

    const leaked = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ? AND properties_json LIKE '%42%'")
      .get(session.session_id) as { total: number };
    expect(Number(leaked.total)).toBe(0);
  });
});
