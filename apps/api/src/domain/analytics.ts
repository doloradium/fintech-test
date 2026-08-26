import {
  resolveVariant,
  type AnalyticsFilters,
  type AnalyticsResponse,
  type FunnelOverview,
  type SegmentMetrics,
  type StepMetrics,
  type VariantKey,
} from '@funnel/shared';
import type { Database } from '../db/database.js';
import { getActiveVersion, getConfig } from './versions.js';

export type AnalyticsQuery = {
  version?: number | null;
  variant?: VariantKey | null;
  utm_campaign?: string | null;
  from?: string | null;
  to?: string | null;
};

type SessionMeta = {
  version: number;
  variant: VariantKey;
  campaign: string | null;
};

type SessionFacts = {
  viewedSteps: Set<string>;
  completedSteps: Set<string>;
  backSteps: Set<string>;
  types: Set<string>;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));

const buildFilter = (query: AnalyticsQuery): { sql: string; params: Array<string | number> } => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.version != null) {
    clauses.push('s.funnel_version = ?');
    params.push(query.version);
  }
  if (query.variant != null) {
    clauses.push('s.variant = ?');
    params.push(query.variant);
  }
  if (query.utm_campaign != null) {
    clauses.push('COALESCE(s.utm_campaign, \'\') = ?');
    params.push(query.utm_campaign);
  }
  if (query.from != null) {
    clauses.push('s.created_at >= ?');
    params.push(query.from);
  }
  if (query.to != null) {
    clauses.push('s.created_at <= ?');
    params.push(query.to);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
};

const emptyFacts = (): SessionFacts => ({
  viewedSteps: new Set(),
  completedSteps: new Set(),
  backSteps: new Set(),
  types: new Set(),
});

const overviewOf = (sessionIds: string[], facts: Map<string, SessionFacts>): FunnelOverview => {
  let reachedResult = 0;
  let ctaClicks = 0;

  for (const sessionId of sessionIds) {
    const fact = facts.get(sessionId);
    if (!fact) continue;
    if (fact.types.has('result_viewed')) reachedResult += 1;
    if (fact.types.has('cta_clicked')) ctaClicks += 1;
  }

  return {
    sessions: sessionIds.length,
    reachedResult,
    ctaClicks,
    completionRate: ratio(reachedResult, sessionIds.length),
    ctaCtr: ratio(ctaClicks, sessionIds.length),
  };
};

const canonicalOrder = (db: Database, query: AnalyticsQuery, seenSteps: Set<string>): Array<{ id: string; title: string | null }> => {
  const version = query.version ?? getActiveVersion(db);
  const order: Array<{ id: string; title: string | null }> = [];
  const used = new Set<string>();

  if (version !== null) {
    try {
      const config = getConfig(db, version);
      const variantKeys: VariantKey[] = query.variant ? [query.variant] : ['A', 'B'];
      for (const key of variantKeys) {
        if (!config.variants.some((variant) => variant.key === key)) continue;
        for (const step of resolveVariant(config, key).steps) {
          if (used.has(step.id)) continue;
          used.add(step.id);
          order.push({ id: step.id, title: step.title });
        }
      }
    } catch {}
  }

  for (const stepId of [...seenSteps].sort()) {
    if (used.has(stepId)) continue;
    used.add(stepId);
    order.push({ id: stepId, title: null });
  }

  return order;
};

export const computeAnalytics = (db: Database, query: AnalyticsQuery = {}): AnalyticsResponse => {
  const filter = buildFilter(query);

  const sessionRows = db
    .prepare(`SELECT s.id, s.funnel_version, s.variant, s.utm_campaign FROM sessions s ${filter.sql}`)
    .all(...filter.params) as unknown as Array<{
    id: string;
    funnel_version: number;
    variant: VariantKey;
    utm_campaign: string | null;
  }>;

  const meta = new Map<string, SessionMeta>();
  for (const row of sessionRows) {
    meta.set(row.id, { version: row.funnel_version, variant: row.variant, campaign: row.utm_campaign });
  }

  const facts = new Map<string, SessionFacts>();
  const seenSteps = new Set<string>();

  const distinctRows = db
    .prepare(
      `SELECT DISTINCT e.session_id, e.type, e.step_id
       FROM events e JOIN sessions s ON s.id = e.session_id
       ${filter.sql}`,
    )
    .all(...filter.params) as unknown as Array<{ session_id: string; type: string; step_id: string | null }>;

  for (const row of distinctRows) {
    let fact = facts.get(row.session_id);
    if (!fact) {
      fact = emptyFacts();
      facts.set(row.session_id, fact);
    }
    fact.types.add(row.type);
    if (row.step_id) {
      if (row.type === 'step_viewed') fact.viewedSteps.add(row.step_id);
      if (row.type === 'step_completed') fact.completedSteps.add(row.step_id);
      if (row.type === 'back_clicked') fact.backSteps.add(row.step_id);
      if (row.type === 'step_viewed' || row.type === 'step_completed') seenSteps.add(row.step_id);
    }
  }

  const order = canonicalOrder(db, query, seenSteps);
  const sessionIds = sessionRows.map((row) => row.id);

  const variantOrderCache = new Map<string, Map<string, number>>();
  const variantOrder = (version: number, variant: VariantKey): Map<string, number> => {
    const key = `${version}:${variant}`;
    const cached = variantOrderCache.get(key);
    if (cached) return cached;

    const map = new Map<string, number>();
    try {
      resolveVariant(getConfig(db, version), variant).steps.forEach((step, index) => map.set(step.id, index));
    } catch {
      order.forEach((step, index) => map.set(step.id, index));
    }
    variantOrderCache.set(key, map);
    return map;
  };

  const maxViewedIndex = new Map<string, number>();
  for (const [sessionId, fact] of facts) {
    const info = meta.get(sessionId);
    if (!info) continue;
    const positions = variantOrder(info.version, info.variant);
    let max = -1;
    for (const stepId of fact.viewedSteps) {
      const index = positions.get(stepId);
      if (index !== undefined && index > max) max = index;
    }
    maxViewedIndex.set(sessionId, max);
  }

  const totalSessions = sessionIds.length;

  const steps: StepMetrics[] = order.map((step) => {
    let entered = 0;
    let completed = 0;
    let continued = 0;
    let backClicks = 0;

    for (const sessionId of sessionIds) {
      const fact = facts.get(sessionId);
      const info = meta.get(sessionId);
      if (!fact || !info) continue;
      if (fact.backSteps.has(step.id)) backClicks += 1;
      if (!fact.viewedSteps.has(step.id)) continue;
      entered += 1;
      if (fact.completedSteps.has(step.id)) completed += 1;
      const ownIndex = variantOrder(info.version, info.variant).get(step.id);
      const reachedLater = ownIndex !== undefined && (maxViewedIndex.get(sessionId) ?? -1) > ownIndex;
      if (reachedLater || fact.types.has('result_viewed')) continued += 1;
    }

    return {
      stepId: step.id,
      title: step.title,
      entered,
      completed,
      continued,
      dropoff: entered - continued,
      dropoffRate: ratio(entered - continued, entered),
      conversionToNext: ratio(continued, entered),
      conversionFromStart: ratio(entered, totalSessions),
      backClicks,
    };
  });

  const groupBy = (pick: (meta: SessionMeta) => string | null, label: (key: string) => string): SegmentMetrics[] => {
    const groups = new Map<string, string[]>();
    for (const sessionId of sessionIds) {
      const info = meta.get(sessionId);
      if (!info) continue;
      const key = pick(info) ?? '(none)';
      const bucket = groups.get(key);
      if (bucket) bucket.push(sessionId);
      else groups.set(key, [sessionId]);
    }

    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .map(([key, ids]) => ({ key, label: label(key), ...overviewOf(ids, facts) }));
  };

  const eventCounts = db
    .prepare(
      `SELECT e.type AS type, COUNT(*) AS events, COUNT(DISTINCT e.session_id) AS sessions
       FROM events e JOIN sessions s ON s.id = e.session_id
       ${filter.sql}
       GROUP BY e.type ORDER BY events DESC`,
    )
    .all(...filter.params) as unknown as Array<{ type: string; events: number; sessions: number }>;

  const orderedArrivals = db
    .prepare(
      `SELECT e.session_id, e.seq
       FROM events e JOIN sessions s ON s.id = e.session_id
       ${filter.sql}
       ORDER BY e.rowid ASC`,
    )
    .all(...filter.params) as unknown as Array<{ session_id: string; seq: number | null }>;

  const maxSeqSeen = new Map<string, number>();
  let outOfOrderEvents = 0;
  for (const row of orderedArrivals) {
    if (row.seq === null) continue;
    const seen = maxSeqSeen.get(row.session_id);
    if (seen !== undefined && row.seq < seen) outOfOrderEvents += 1;
    if (seen === undefined || row.seq > seen) maxSeqSeen.set(row.session_id, row.seq);
  }

  const stats = db.prepare('SELECT accepted, duplicates, rejected FROM ingest_stats WHERE id = 1').get() as
    | { accepted: number; duplicates: number; rejected: number }
    | undefined;

  const available = {
    versions: (
      db.prepare('SELECT DISTINCT funnel_version AS v FROM sessions ORDER BY v').all() as unknown as Array<{ v: number }>
    ).map((row) => Number(row.v)),
    variants: (
      db.prepare('SELECT DISTINCT variant AS v FROM sessions ORDER BY v').all() as unknown as Array<{ v: VariantKey }>
    ).map((row) => row.v),
    campaigns: (
      db
        .prepare("SELECT DISTINCT COALESCE(utm_campaign, '') AS v FROM sessions ORDER BY v")
        .all() as unknown as Array<{ v: string }>
    ).map((row) => row.v),
  };

  const filters: AnalyticsFilters = {
    version: query.version ?? null,
    variant: query.variant ?? null,
    utm_campaign: query.utm_campaign ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
  };

  return {
    generated_at: new Date().toISOString(),
    filters,
    overview: overviewOf(sessionIds, facts),
    steps,
    byVariant: groupBy((info) => info.variant, (key) => `Вариант ${key}`),
    byVersion: groupBy((info) => String(info.version), (key) => `Версия ${key}`),
    byCampaign: groupBy((info) => info.campaign, (key) => (key === '(none)' ? 'Без кампании' : key)),
    eventCounts: eventCounts.map((row) => ({
      type: row.type,
      events: Number(row.events),
      sessions: Number(row.sessions),
    })),
    dataQuality: {
      events: eventCounts.reduce((sum, row) => sum + Number(row.events), 0),
      duplicateAttempts: Number(stats?.duplicates ?? 0),
      rejectedEvents: Number(stats?.rejected ?? 0),
      outOfOrderEvents,
      sessionsWithBack: sessionIds.filter((id) => facts.get(id)?.types.has('back_clicked')).length,
    },
    available,
  };
};
