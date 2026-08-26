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

  const countEvents = (sessionId: string): number => {
    const row = ctx.db.prepare('SELECT COUNT(*) AS total FROM events WHERE session_id = ?').get(sessionId) as {
      total: number;
    };
    return Number(row.total);
  };

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
      { event_id: 'short', session_id: session.session_id, type: 'step_viewed', client_ts: 'не дата' },
      event('00000000-0000-0000-0000-000000000000', 'step_viewed', 'intro'),
      event(session.session_id, 'step_viewed'),
      event(session.session_id, 'totally_unknown_event'),
      event(session.session_id, 'step_completed', 'intro'),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(4);
    expect(result.rejected.map((item) => (item as { reason: string }).reason.split(':')[0])).toEqual([
      'validation_failed',
      'unknown_session',
      'missing_step_id',
      'unknown_event_type',
    ]);
    expect(countEvents(session.session_id)).toBe(2);
  });

  it('сырые ответы пользователя не попадают в таблицу событий', async () => {
    const session = await createSession(ctx.app);

    await sendEvents(ctx.app, [
      event(session.session_id, 'answer_submitted', 'intro', {
        props: { value_type: 'boolean', value: 'секретный ответ', phone: '+7 900 000-00-00' },
      }),
    ]);

    const row = ctx.db
      .prepare("SELECT props_json FROM events WHERE session_id = ? AND type = 'answer_submitted'")
      .get(session.session_id) as { props_json: string | null };

    expect(row.props_json).toBe('{"value_type":"boolean"}');
  });
});
