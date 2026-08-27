import { randomUUID } from 'node:crypto';
import type { SessionView, Step } from '@funnel/shared';

type Args = {
  url: string;
  sessions: number;
  seed: number;
  concurrency: number;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    url: process.env.API_URL ?? 'http://localhost:3000',
    sessions: 120,
    seed: 20260826,
    concurrency: 8,
  };

  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    if (!rawKey || rawValue === undefined) continue;
    if (rawKey === 'url') args.url = rawValue;
    if (rawKey === 'sessions') args.sessions = Number(rawValue);
    if (rawKey === 'seed') args.seed = Number(rawValue);
    if (rawKey === 'concurrency') args.concurrency = Number(rawValue);
  }

  return args;
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const UTM_POOL = [
  { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'workstyle_search', utm_content: 'ad_1', utm_term: 'hybrid work policy' },
  { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'workstyle_search', utm_content: 'ad_2', utm_term: 'remote team setup' },
  { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'q3_thought_leadership', utm_content: 'carousel', utm_term: null },
  { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'q3_thought_leadership', utm_content: 'issue_14', utm_term: null },
  { utm_source: 'partner', utm_medium: 'referral', utm_campaign: 'partner_launch', utm_content: null, utm_term: null },
  { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null },
];

type QueuedEvent = {
  event_id: string;
  session_id: string;
  name: string;
  step_id?: string | null;
  client_timestamp: string;
  seq: number;
  properties?: Record<string, unknown>;
};

type Stats = {
  sessions: number;
  completed: number;
  ctaClicks: number;
  droppedAt: Record<string, number>;
  results: Record<string, number>;
  batchesSent: number;
  batchesResent: number;
  shuffledBatches: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  variants: Record<string, number>;
};

const post = async (url: string, body: unknown): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`POST ${url} → ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const pickAnswer = (step: Step, random: () => number): string | number | string[] | boolean => {
  if (step.type === 'info' || step.type === 'result') return true;

  const options = step.input?.options ?? [];

  if (step.type === 'single-select') {
    const index = Math.floor(random() * options.length);
    return options[Math.min(index, options.length - 1)]?.value ?? options[0]?.value ?? '';
  }

  if (step.type === 'multi-select') {
    const min = step.validation?.minSelections ?? 1;
    const max = step.validation?.maxSelections ?? options.length;
    const count = Math.min(Math.max(min, 1 + Math.floor(random() * max)), max, options.length);
    const shuffled = [...options].sort(() => random() - 0.5);
    return shuffled.slice(0, count).map((option) => option.value);
  }

  const min = step.input?.min ?? 1;
  const max = step.input?.max ?? min + 10;
  const skew = random() * random();
  return Math.round(min + skew * (max - min));
};

const shuffle = <T>(items: T[], random: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
};

const runSession = async (args: Args, sessionIndex: number, stats: Stats): Promise<void> => {
  const random = mulberry32((args.seed ^ Math.imul(sessionIndex + 1, 0x9e3779b9)) >>> 0);
  const utm = UTM_POOL[Math.floor(random() * UTM_POOL.length)] ?? UTM_POOL[0];
  const forceVariant = random() < 0.06 ? (random() < 0.5 ? 'A' : 'B') : null;

  let view = (await post(`${args.url}/api/sessions`, { utm, variant: forceVariant })) as SessionView;
  stats.sessions += 1;
  stats.variants[view.variant] = (stats.variants[view.variant] ?? 0) + 1;

  const queue: QueuedEvent[] = [];
  let seq = 0;
  const push = (name: string, stepId: string | null, properties?: Record<string, unknown>): void => {
    seq += 1;
    queue.push({
      event_id: randomUUID(),
      session_id: view.session_id,
      name,
      step_id: stepId,
      client_timestamp: new Date().toISOString(),
      seq,
      ...(properties ? { properties } : {}),
    });
  };

  push('session_started', null);

  const dropChance = 0.03 + random() * 0.13;
  let guard = 0;

  while (guard < 40) {
    guard += 1;
    const stepId = view.current_step_id;
    const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
    if (!step) break;

    if (step.type === 'result') {
      push('result_viewed', stepId, { result_id: view.result_id });
      stats.completed += 1;
      if (view.result_id) stats.results[view.result_id] = (stats.results[view.result_id] ?? 0) + 1;

      const ctaChance = view.variant === 'B' ? 0.46 : 0.36;
      if (random() < ctaChance) {
        const result = view.result_id ? view.funnel.results[view.result_id] : undefined;
        push('cta_clicked', stepId, { result_id: view.result_id, action: result?.cta.action ?? 'primary' });
        stats.ctaClicks += 1;

        if (
          result?.cta.action === 'expand_recommendation' &&
          view.funnel.events.allowed.some((event) => event.name === 'recommendation_expanded')
        ) {
          push('recommendation_expanded', stepId, { result_id: view.result_id });
        }
      }
      break;
    }

    push('step_viewed', stepId, {
      step_type: step.type,
      visible_step_index: view.progress.index + 1,
      visible_step_count: view.progress.total,
    });
    if (random() < 0.25) {
      push('step_viewed', stepId, {
        step_type: step.type,
        visible_step_index: view.progress.index + 1,
        visible_step_count: view.progress.total,
      });
    }

    if (random() < dropChance) {
      stats.droppedAt[stepId] = (stats.droppedAt[stepId] ?? 0) + 1;
      break;
    }

    const value = pickAnswer(step, random);
    push('answer_submitted', stepId, { answer_kind: step.type });

    view = (await post(`${args.url}/api/sessions/${view.session_id}/answer`, { step_id: stepId, value })) as SessionView;
    push('step_completed', stepId, { next_step_id: view.current_step_id });

    if (random() < 0.18) {
      const currentIndex = view.path.indexOf(view.current_step_id);
      const previous = view.path[Math.max(currentIndex - 1, 0)];
      if (previous && previous !== view.current_step_id) {
        push('back_clicked', view.current_step_id, { destination_step_id: previous });
        view = (await post(`${args.url}/api/sessions/${view.session_id}/navigate`, { step_id: previous })) as SessionView;
      }
    }
  }

  if (random() < 0.2 && queue.length > 2) {
    const clone = queue[Math.floor(random() * queue.length)];
    if (clone) queue.push({ ...clone });
  }

  const chunks: QueuedEvent[][] = [];
  const chunkSize = 4 + Math.floor(random() * 6);
  for (let i = 0; i < queue.length; i += chunkSize) chunks.push(queue.slice(i, i + chunkSize));

  for (const chunk of chunks) {
    const outOfOrder = random() < 0.25 && chunk.length > 2;
    const payload = outOfOrder ? shuffle(chunk, random) : chunk;
    if (outOfOrder) stats.shuffledBatches += 1;

    const result = (await post(`${args.url}/api/events`, { events: payload })) as {
      accepted: number;
      duplicates: number;
      rejected: unknown[];
    };
    stats.batchesSent += 1;
    stats.accepted += result.accepted;
    stats.duplicates += result.duplicates;
    stats.rejected += result.rejected.length;

    if (random() < 0.15) {
      const retry = (await post(`${args.url}/api/events`, { events: payload })) as {
        accepted: number;
        duplicates: number;
        rejected: unknown[];
      };
      stats.batchesResent += 1;
      stats.accepted += retry.accepted;
      stats.duplicates += retry.duplicates;
      stats.rejected += retry.rejected.length;
    }
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  const health = await fetch(`${args.url}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`API не отвечает на ${args.url}. Запустите сервер: npm run dev (или npm start).`);
    process.exit(1);
  }

  const stats: Stats = {
    sessions: 0,
    completed: 0,
    ctaClicks: 0,
    droppedAt: {},
    results: {},
    batchesSent: 0,
    batchesResent: 0,
    shuffledBatches: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    variants: {},
  };

  const started = Date.now();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < args.sessions) {
      const sessionIndex = cursor;
      cursor += 1;
      await runSession(args, sessionIndex, stats);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, () => worker()));

  console.log(`Сгенерировано за ${((Date.now() - started) / 1000).toFixed(1)} с`);
  console.table({
    Сессий: stats.sessions,
    'Дошли до результата': stats.completed,
    'Клики по CTA': stats.ctaClicks,
    'Вариант A': stats.variants.A ?? 0,
    'Вариант B': stats.variants.B ?? 0,
    'Пачек отправлено': stats.batchesSent,
    'Пачек продублировано': stats.batchesResent,
    'Пачек с нарушенным порядком': stats.shuffledBatches,
    'Событий принято': stats.accepted,
    'Событий отброшено как дубли': stats.duplicates,
    'Событий отклонено': stats.rejected,
  });
  console.log('Отвалы по шагам:', stats.droppedAt);
  console.log('Результаты:', stats.results);
};

await main();
