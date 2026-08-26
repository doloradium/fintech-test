import { z } from 'zod';

export const CORE_EVENT_NAMES = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
] as const;

export type CoreEventName = (typeof CORE_EVENT_NAMES)[number];

export const STEP_SCOPED_EVENT_NAMES: readonly string[] = [
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
];

export const eventNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,63}$/, 'event name must be snake_case, 3..64 chars');

export const eventInputSchema = z.object({
  event_id: z.string().min(8).max(64),
  session_id: z.string().min(8).max(64),
  name: eventNameSchema,
  client_timestamp: z.iso.datetime({ offset: true }),
  seq: z.number().int().min(0).optional(),
  step_id: z.string().max(64).nullish(),
  properties: z.record(z.string(), z.unknown()).nullish(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export const eventBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(500),
});

export type EventRejection = {
  index: number;
  event_id: string | null;
  reason: string;
};

export type IngestResult = {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: EventRejection[];
};

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export const utmSchema = z.object({
  utm_source: z.string().max(120).nullish(),
  utm_medium: z.string().max(120).nullish(),
  utm_campaign: z.string().max(120).nullish(),
  utm_content: z.string().max(120).nullish(),
  utm_term: z.string().max(120).nullish(),
});

export type Utm = z.infer<typeof utmSchema>;
