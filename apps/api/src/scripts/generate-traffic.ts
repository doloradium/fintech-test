import { generateTraffic, type TrafficArgs } from './traffic.js';

const parseArgs = (argv: string[]): TrafficArgs => {
  const args: TrafficArgs = {
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

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  const health = await fetch(`${args.url}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`API не отвечает на ${args.url}. Запустите сервер: npm run dev (или npm start).`);
    process.exit(1);
  }

  const started = Date.now();
  const stats = await generateTraffic(args);

  console.log(`Сгенерировано за ${((Date.now() - started) / 1000).toFixed(1)} с`);
  console.table({
    Сессий: stats.sessions,
    'Дошли до результата': stats.completed,
    'Клики по CTA': stats.ctaClicks,
    ...Object.fromEntries(
      Object.entries(stats.variants)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, count]) => [`Вариант ${key}`, count]),
    ),
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
