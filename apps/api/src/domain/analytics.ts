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
  resultId: string | null;
};

type SessionFacts = {
  viewedSteps: Set<string>;
  completedSteps: Set<string>;
  backSteps: Set<string>;
  names: Set<string>;
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
    clauses.push("COALESCE(s.utm_campaign, '') = ?");
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
  names: new Set(),
});

const overviewOf = (sessionIds: string[], facts: Map<string, SessionFacts>): FunnelOverview => {
  let reachedResult = 0;
  let ctaClicks = 0;

  for (const sessionId of sessionIds) {
    const fact = facts.get(sessionId);
    if (!fact) continue;
    if (fact.names.has('result_viewed')) reachedResult += 1;
    if (fact.names.has('cta_clicked')) ctaClicks += 1;
  }

  return {
    sessions: sessionIds.length,
    reachedResult,
    ctaClicks,
    completionRate: ratio(reachedResult, sessionIds.length),
    ctaCtr: ratio(ctaClicks, sessionIds.length),
  };
};

type StepInfo = { id: string; title: string | null; type: string | null };

const canonicalOrder = (db: Database, query: AnalyticsQuery, seenSteps: Set<string>): StepInfo[] => {
  const version = query.version ?? getActiveVersion(db);
  const order: StepInfo[] = [];
  const used = new Set<string>();

  if (version !== null) {
    try {
      const config = getConfig(db, version);
      const keys = query.variant ? [query.variant] : Object.keys(config.experiment.variants);
      for (const key of keys) {
        if (!config.experiment.variants[key]) continue;
        for (const step of resolveVariant(config, key).steps) {
          if (used.has(step.id)) continue;
          used.add(step.id);
          order.push({ id: step.id, title: step.content.title ?? null, type: step.type });
        }
      }
    } catch {}
  }

  for (const stepId of [...seenSteps].sort()) {
    if (used.has(stepId)) continue;
    used.add(stepId);
    order.push({ id: stepId, title: null, type: null });
  }

  return order;
};

const configVariantKeys = (db: Database, query: AnalyticsQuery): VariantKey[] | null => {
  if (query.version != null) {
    try {
      return Object.keys(getConfig(db, query.version).experiment.variants);
    } catch {
      return null;
    }
  }

  const rows = db.prepare('SELECT version FROM funnel_versions ORDER BY version').all() as unknown as Array<{
    version: number;
  }>;
  const keys: VariantKey[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      for (const key of Object.keys(getConfig(db, row.version).experiment.variants)) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    } catch {}
  }

  return keys.length > 0 ? keys : null;
};

export const computeAnalytics = (db: Database, query: AnalyticsQuery = {}): AnalyticsResponse => {
  const filter = buildFilter(query);

  const sessionRows = db
    .prepare(
      `SELECT s.id, s.funnel_version, s.variant, s.utm_campaign, s.result_id FROM sessions s ${filter.sql}`,
    )
    .all(...filter.params) as unknown as Array<{
    id: string;
    funnel_version: number;
    variant: VariantKey;
    utm_campaign: string | null;
    result_id: string | null;
  }>;

  const meta = new Map<string, SessionMeta>();
  for (const row of sessionRows) {
    meta.set(row.id, {
      version: row.funnel_version,
      variant: row.variant,
      campaign: row.utm_campaign,
      resultId: row.result_id,
    });
  }

  const facts = new Map<string, SessionFacts>();
  const seenSteps = new Set<string>();

  const distinctRows = db
    .prepare(
      `SELECT DISTINCT e.session_id, e.name, e.step_id
       FROM events e JOIN sessions s ON s.id = e.session_id
       ${filter.sql}`,
    )
    .all(...filter.params) as unknown as Array<{ session_id: string; name: string; step_id: string | null }>;

  for (const row of distinctRows) {
    let fact = facts.get(row.session_id);
    if (!fact) {
      fact = emptyFacts();
      facts.set(row.session_id, fact);
    }
    fact.names.add(row.name);
    if (row.step_id) {
      if (row.name === 'step_viewed' || row.name === 'result_viewed') fact.viewedSteps.add(row.step_id);
      if (row.name === 'step_completed' || row.name === 'cta_clicked') fact.completedSteps.add(row.step_id);
      if (row.name === 'back_clicked') fact.backSteps.add(row.step_id);
      if (row.name !== 'back_clicked') seenSteps.add(row.step_id);
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
      const isCompleted = fact.completedSteps.has(step.id);
      if (isCompleted) completed += 1;

      if (step.type === 'result') {
        if (isCompleted) continued += 1;
        continue;
      }

      const ownIndex = variantOrder(info.version, info.variant).get(step.id);
      const reachedLater = ownIndex !== undefined && (maxViewedIndex.get(sessionId) ?? -1) > ownIndex;
      if (reachedLater || fact.names.has('result_viewed')) continued += 1;
    }

    return {
      stepId: step.id,
      title: step.title,
      type: step.type,
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

  const groupBy = (pick: (info: SessionMeta) => string | null, label: (key: string) => string): SegmentMetrics[] => {
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

  const resultTitles = new Map<string, string>();
  const activeVersion = query.version ?? getActiveVersion(db);
  if (activeVersion !== null) {
    try {
      for (const [id, result] of Object.entries(getConfig(db, activeVersion).results)) {
        resultTitles.set(id, result.title);
      }
    } catch {}
  }

  const resultGroups = new Map<string, { sessions: number; ctaClicks: number }>();
  for (const sessionId of sessionIds) {
    const info = meta.get(sessionId);
    if (!info?.resultId) continue;
    const bucket = resultGroups.get(info.resultId) ?? { sessions: 0, ctaClicks: 0 };
    bucket.sessions += 1;
    if (facts.get(sessionId)?.names.has('cta_clicked')) bucket.ctaClicks += 1;
    resultGroups.set(info.resultId, bucket);
  }

  const eventCounts = db
    .prepare(
      `SELECT e.name AS name, COUNT(*) AS events, COUNT(DISTINCT e.session_id) AS sessions
       FROM events e JOIN sessions s ON s.id = e.session_id
       ${filter.sql}
       GROUP BY e.name ORDER BY events DESC`,
    )
    .all(...filter.params) as unknown as Array<{ name: string; events: number; sessions: number }>;

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
    byVariant: (() => {
      const grouped = groupBy((info) => info.variant, (key) => key);
      const keys = configVariantKeys(db, query);
      if (!keys) return grouped;
      const byKey = new Map(grouped.map((segment) => [segment.key, segment]));
      return keys.map(
        (key) =>
          byKey.get(key) ?? {
            key,
            label: key,
            sessions: 0,
            reachedResult: 0,
            ctaClicks: 0,
            completionRate: 0,
            ctaCtr: 0,
          },
      );
    })(),
    byVersion: groupBy((info) => String(info.version), (key) => `Версия ${key}`),
    byCampaign: groupBy((info) => info.campaign, (key) => (key === '(none)' ? 'Без кампании' : key)),
    byResult: [...resultGroups.entries()]
      .sort((a, b) => b[1].sessions - a[1].sessions)
      .map(([resultId, bucket]) => ({
        resultId,
        title: resultTitles.get(resultId) ?? null,
        sessions: bucket.sessions,
        ctaClicks: bucket.ctaClicks,
        ctaCtr: ratio(bucket.ctaClicks, bucket.sessions),
      })),
    eventCounts: eventCounts.map((row) => ({
      name: row.name,
      events: Number(row.events),
      sessions: Number(row.sessions),
    })),
    dataQuality: {
      events: eventCounts.reduce((sum, row) => sum + Number(row.events), 0),
      duplicateAttempts: Number(stats?.duplicates ?? 0),
      rejectedEvents: Number(stats?.rejected ?? 0),
      outOfOrderEvents,
      sessionsWithBack: sessionIds.filter((id) => facts.get(id)?.names.has('back_clicked')).length,
    },
    available: {
      versions: (
        db.prepare('SELECT DISTINCT funnel_version AS v FROM sessions ORDER BY v').all() as unknown as Array<{ v: number }>
      ).map((row) => Number(row.v)),
      variants:
        configVariantKeys(db, query) ??
        (
          db.prepare('SELECT DISTINCT variant AS v FROM sessions ORDER BY v').all() as unknown as Array<{ v: VariantKey }>
        ).map((row) => row.v),
      campaigns: (
        (query.version != null
          ? db
              .prepare(
                `SELECT COALESCE(utm_campaign, '') AS v, COUNT(*) AS n FROM sessions
                 WHERE funnel_version = ? GROUP BY 1 ORDER BY n DESC, v LIMIT 100`,
              )
              .all(query.version)
          : db
              .prepare(
                `SELECT COALESCE(utm_campaign, '') AS v, COUNT(*) AS n FROM sessions
                 GROUP BY 1 ORDER BY n DESC, v LIMIT 100`,
              )
              .all()) as unknown as Array<{ v: string }>
      ).map((row) => row.v),
    },
  };
};
