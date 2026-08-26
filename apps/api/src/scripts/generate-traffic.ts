import { randomUUID } from 'node:crypto';
import { RESULT_STEP_ID, type SessionView, type Step } from '@funnel/shared';

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
  { utm_source: 'yandex', utm_medium: 'cpc', utm_campaign: 'remont_search', utm_content: 'ad_1', utm_term: 'ремонт квартиры' },
  { utm_source: 'yandex', utm_medium: 'cpc', utm_campaign: 'remont_search', utm_content: 'ad_2', utm_term: 'ремонт под ключ' },
  { utm_source: 'vk', utm_medium: 'social', utm_campaign: 'spring_promo', utm_content: 'carousel', utm_term: null },
  { utm_source: 'telegram', utm_medium: 'social', utm_campaign: 'spring_promo', utm_content: 'post_12', utm_term: null },
  { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'reactivation', utm_content: 'may', utm_term: null },
  { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null },
];

type QueuedEvent = {
  event_id: string;
  session_id: string;
  type: string;
  step_id?: string | null;
  client_ts: string;
  seq: number;
  props?: Record<string, unknown>;
};

type Stats = {
  sessions: number;
  completed: number;
  ctaClicks: number;
  droppedAt: Record<string, number>;
  batchesSent: number;
  batchesResent: number;
  shuffledBatches: number;
  duplicateEvents: number;
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
  if (!response.ok) {
    throw new Error(`POST ${url} → ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
};

const pickAnswer = (step: Step, random: () => number): string | number | string[] | boolean => {
  if (step.type === 'info') return true;
  if (step.type === 'single_select') {
    const index = Math.floor(random() * step.options.length);
    return step.options[Math.min(index, step.options.length - 1)]?.value ?? step.options[0]?.value ?? '';
  }
  if (step.type === 'multi_select') {
    const max = step.maxSelected ?? step.options.length;
    const count = Math.max(step.minSelected, 1 + Math.floor(random() * Math.min(3, max)));
    const shuffled = [...step.options].sort(() => random() - 0.5);
    return shuffled.slice(0, Math.min(count, max)).map((option) => option.value);
  }
  const min = step.min ?? 1;
  const max = step.max ?? min + 10;
  return Math.round(min + random() * (max - min));
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

const runSession = async (args: Args, random: () => number, stats: Stats): Promise<void> => {
  const utm = UTM_POOL[Math.floor(random() * UTM_POOL.length)] ?? UTM_POOL[0];
  const forceVariant = random() < 0.06 ? (random() < 0.5 ? 'A' : 'B') : null;

  let view = (await post(`${args.url}/api/sessions`, { utm, variant: forceVariant })) as SessionView;
  stats.sessions += 1;
  stats.variants[view.variant] = (stats.variants[view.variant] ?? 0) + 1;

  const queue: QueuedEvent[] = [];
  let seq = 0;
  const now = () => new Date().toISOString();
  const push = (type: string, stepId: string | null, props?: Record<string, unknown>): void => {
    seq += 1;
    queue.push({
      event_id: randomUUID(),
      session_id: view.session_id,
      type,
      step_id: stepId,
      client_ts: now(),
      seq,
      ...(props ? { props } : {}),
    });
  };

  push('session_started', null, { entry: utm?.utm_source ?? 'direct' });

  const supportsHints = view.funnel.extraEvents.includes('hint_opened');
  const dropChance = 0.03 + random() * 0.13;
  let guard = 0;
  let dropped = false;

  while (view.current_step_id !== RESULT_STEP_ID && guard < 40) {
    guard += 1;
    const stepId = view.current_step_id;
    const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
    if (!step) break;

    push('step_viewed', stepId);
    if (random() < 0.25) push('step_viewed', stepId);
    if (supportsHints && step.hint && random() < 0.4) push('hint_opened', stepId);

    if (random() < dropChance) {
      stats.droppedAt[stepId] = (stats.droppedAt[stepId] ?? 0) + 1;
      dropped = true;
      break;
    }

    const value = pickAnswer(step, random);
    push('answer_submitted', stepId, {
      value_type: Array.isArray(value) ? 'array' : typeof value,
      option_count: Array.isArray(value) ? value.length : 1,
    });

    view = (await post(`${args.url}/api/sessions/${view.session_id}/answer`, {
      step_id: stepId,
      value,
    })) as SessionView;

    push('step_completed', stepId);

    if (random() < 0.18 && view.path.length > 1) {
      const currentIndex = view.path.indexOf(view.current_step_id);
      const previous = view.path[Math.max(currentIndex - 1, 0)];
      if (previous && previous !== view.current_step_id) {
        push('back_clicked', view.current_step_id, { to_step_id: previous });
        view = (await post(`${args.url}/api/sessions/${view.session_id}/navigate`, {
          step_id: previous,
        })) as SessionView;
      }
    }
  }

  if (!dropped && view.current_step_id === RESULT_STEP_ID) {
    push('result_viewed', RESULT_STEP_ID);
    stats.completed += 1;
    const ctaChance = view.variant === 'B' ? 0.44 : 0.35;
    if (random() < ctaChance) {
      push('cta_clicked', RESULT_STEP_ID, { cta_id: view.funnel.result.cta.id });
      stats.ctaClicks += 1;
    }
  }

  if (random() < 0.2 && queue.length > 2) {
    const clone = queue[Math.floor(random() * queue.length)];
    if (clone) {
      queue.push({ ...clone });
      stats.duplicateEvents += 1;
    }
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
  const random = mulberry32(args.seed);

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
    batchesSent: 0,
    batchesResent: 0,
    shuffledBatches: 0,
    duplicateEvents: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    variants: {},
  };

  const started = Date.now();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < args.sessions) {
      cursor += 1;
      await runSession(args, random, stats);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, () => worker()));

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Сгенерировано за ${elapsed} с`);
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
};

await main();
