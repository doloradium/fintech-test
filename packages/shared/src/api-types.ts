import type { Answers } from './conditions.js';
import type { ResolvedFunnel } from './resolve.js';
import type { VariantKey } from './funnel-config.js';
import type { Utm } from './events.js';

export type SessionProgress = {
  index: number;
  total: number;
  ratio: number;
};

export type SessionView = {
  session_id: string;
  funnel_version: number;
  variant: VariantKey;
  variant_source: 'assigned' | 'override';
  created_at: string;
  completed_at: string | null;
  current_step_id: string;
  path: string[];
  progress: SessionProgress;
  answers: Answers;
  utm: Utm;
  funnel: ResolvedFunnel;
};

export type AdvanceResponse = {
  ok: true;
  session: SessionView;
};

export type VersionSummary = {
  version: number;
  funnel_id: string;
  name: string;
  checksum: string;
  notes: string | null;
  created_at: string;
  is_active: boolean;
  steps: number;
  sessions: number;
  variants: Array<{ key: VariantKey; label: string; steps: number }>;
};

export type ActivationEntry = {
  id: number;
  version: number;
  action: 'publish' | 'rollback' | 'activate';
  actor: string;
  created_at: string;
  note: string | null;
};

export type VersionsResponse = {
  active_version: number | null;
  versions: VersionSummary[];
  activations: ActivationEntry[];
  bundled_configs: Array<{ file: string; name: string; funnel_id: string; steps: number }>;
};

export type FunnelOverview = {
  sessions: number;
  reachedResult: number;
  ctaClicks: number;
  completionRate: number;
  ctaCtr: number;
};

export type StepMetrics = {
  stepId: string;
  title: string | null;
  entered: number;
  completed: number;
  continued: number;
  dropoff: number;
  dropoffRate: number;
  conversionToNext: number;
  conversionFromStart: number;
  backClicks: number;
};

export type SegmentMetrics = FunnelOverview & {
  key: string;
  label: string;
};

export type AnalyticsFilters = {
  version: number | null;
  variant: VariantKey | null;
  utm_campaign: string | null;
  from: string | null;
  to: string | null;
};

export type AnalyticsResponse = {
  generated_at: string;
  filters: AnalyticsFilters;
  overview: FunnelOverview;
  steps: StepMetrics[];
  byVariant: SegmentMetrics[];
  byVersion: SegmentMetrics[];
  byCampaign: SegmentMetrics[];
  eventCounts: Array<{ type: string; events: number; sessions: number }>;
  dataQuality: {
    events: number;
    duplicateAttempts: number;
    rejectedEvents: number;
    outOfOrderEvents: number;
    sessionsWithBack: number;
  };
  available: {
    versions: number[];
    variants: VariantKey[];
    campaigns: string[];
  };
};
