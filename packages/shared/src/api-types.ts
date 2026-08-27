import type { Answers } from './conditions.js';
import type { ResolvedFunnel } from './resolve.js';
import type { VariantKey } from './funnel-config.js';
import type { Utm } from './events.js';

export type SessionProgress = {
  index: number;
  total: number;
  ratio: number;
  counted: boolean;
};

export type SessionView = {
  session_id: string;
  funnel_id: string;
  funnel_version: number;
  experiment_id: string;
  variant: VariantKey;
  variant_source: 'assigned' | 'override';
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  current_step_id: string;
  result_id: string | null;
  path: string[];
  progress: SessionProgress;
  answers: Answers;
  utm: Utm;
  funnel: ResolvedFunnel;
};

export type VersionSummary = {
  version: number;
  funnel_id: string;
  title: string;
  schema_version: string;
  checksum: string;
  notes: string | null;
  created_at: string;
  is_active: boolean;
  steps: number;
  sessions: number;
  results: number;
  events: string[];
  override_query_param: string;
  variants: Array<{ key: VariantKey; steps: number; weight: number }>;
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
  bundled_configs: Array<{ file: string; title: string; funnel_id: string; steps: number }>;
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
  type: string | null;
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
  byResult: Array<{ resultId: string; title: string | null; sessions: number; ctaClicks: number; ctaCtr: number }>;
  eventCounts: Array<{ name: string; events: number; sessions: number }>;
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
