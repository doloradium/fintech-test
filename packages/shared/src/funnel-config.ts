import { z } from 'zod';
import { conditionSchema } from './conditions.js';

export const STEP_TYPES = ['info', 'number', 'single-select', 'multi-select', 'result'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const INTERACTIVE_STEP_TYPES: readonly StepType[] = ['number', 'single-select', 'multi-select'];

export const contentSchema = z
  .object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    helperText: z.string().optional(),
    primaryActionLabel: z.string().optional(),
    backActionLabel: z.string().optional(),
    loadingTitle: z.string().optional(),
    errorTitle: z.string().optional(),
    retryLabel: z.string().optional(),
  })
  .catchall(z.unknown());

export type StepContent = z.infer<typeof contentSchema>;

export const optionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const inputSchema = z.object({
  name: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(optionSchema).optional(),
});

export const validationSchema = z.object({
  required: z.boolean().default(false),
  minSelections: z.number().int().min(0).optional(),
  maxSelections: z.number().int().min(1).optional(),
  messages: z.record(z.string(), z.string()).default({}),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(STEP_TYPES),
  content: contentSchema.default({}),
  input: inputSchema.optional(),
  validation: validationSchema.optional(),
  visibleWhen: conditionSchema.optional(),
  resultSource: z.string().optional(),
});

export type Step = z.infer<typeof stepSchema>;

export const ctaSchema = z.object({
  label: z.string().min(1),
  action: z.string().default('primary'),
});

export const resultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(''),
  recommendations: z.array(z.string()).default([]),
  cta: ctaSchema,
});

export type FunnelResult = z.infer<typeof resultSchema>;

export const resultRuleSchema = z.object({
  resultId: z.string().min(1),
  when: conditionSchema,
});

export type ResultRule = z.infer<typeof resultRuleSchema>;

export const variantSchema = z.object({
  weight: z.number().min(0).default(50),
  stepSequence: z.array(z.string().min(1)).min(1),
  stepOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  resultOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export type Variant = z.infer<typeof variantSchema>;
export type VariantKey = string;

export const experimentSchema = z.object({
  id: z.string().min(1),
  assignment: z.string().default('server'),
  sticky: z.boolean().default(true),
  overrideQueryParam: z.string().default('variant'),
  variants: z.record(z.string().min(1), variantSchema),
});

export const eventDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  trigger: z.string().default(''),
  properties: z.array(z.string()).default([]),
});

export type EventDefinition = z.infer<typeof eventDefinitionSchema>;

export const eventsSchema = z.object({
  baseProperties: z.array(z.string()).default([]),
  allowed: z.array(eventDefinitionSchema).min(1),
  privacy: z
    .object({
      storeRawAnswers: z.boolean().default(false),
      allowAnswerKinds: z.boolean().default(true),
    })
    .prefault({}),
});

export const progressSchema = z.object({
  countVisibleOnly: z.boolean().default(true),
  excludeTypes: z.array(z.enum(STEP_TYPES)).default(['info', 'result']),
});

export const sessionPolicySchema = z.object({
  ttlHours: z.number().positive().default(72),
  persistAnswers: z.boolean().default(true),
  pinVersion: z.boolean().default(true),
  pinExperimentVariant: z.boolean().default(true),
});

export const funnelConfigSchema = z
  .object({
    schemaVersion: z.string().min(1),
    funnelId: z.string().min(1),
    version: z.number().int().positive().optional(),
    status: z.string().default('published'),
    locale: z.string().default('en'),
    title: z.string().min(1),
    description: z.string().default(''),
    session: sessionPolicySchema.prefault({}),
    progress: progressSchema.prefault({}),
    experiment: experimentSchema,
    steps: z.record(z.string().min(1), stepSchema),
    resultRules: z.array(resultRuleSchema).default([]),
    defaultResultId: z.string().min(1),
    results: z.record(z.string().min(1), resultSchema),
    events: eventsSchema,
  })
  .superRefine((config, ctx) => {
    const stepIds = new Set(Object.keys(config.steps));
    const resultIds = new Set(Object.keys(config.results));
    const variantKeys = Object.keys(config.experiment.variants);

    for (const [id, step] of Object.entries(config.steps)) {
      if (step.id !== id) {
        ctx.addIssue({ code: 'custom', path: ['steps', id, 'id'], message: `step key "${id}" does not match its id "${step.id}"` });
      }
    }

    if (variantKeys.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['experiment', 'variants'], message: 'the experiment needs at least two variants' });
    }

    for (const key of variantKeys) {
      const variant = config.experiment.variants[key];
      if (!variant) continue;

      if (variant.stepSequence.length < 6) {
        ctx.addIssue({
          code: 'custom',
          path: ['experiment', 'variants', key, 'stepSequence'],
          message: 'each variant must expose at least 6 screens',
        });
      }

      if (new Set(variant.stepSequence).size !== variant.stepSequence.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['experiment', 'variants', key, 'stepSequence'],
          message: 'stepSequence contains duplicates',
        });
      }

      variant.stepSequence.forEach((stepId, index) => {
        if (!stepIds.has(stepId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['experiment', 'variants', key, 'stepSequence', index],
            message: `unknown step "${stepId}"`,
          });
        }
      });

      for (const overriddenId of Object.keys(variant.stepOverrides)) {
        if (!stepIds.has(overriddenId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['experiment', 'variants', key, 'stepOverrides', overriddenId],
            message: `override targets unknown step "${overriddenId}"`,
          });
        }
      }

      for (const overriddenId of Object.keys(variant.resultOverrides)) {
        if (!resultIds.has(overriddenId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['experiment', 'variants', key, 'resultOverrides', overriddenId],
            message: `override targets unknown result "${overriddenId}"`,
          });
        }
      }

      const lastStepId = variant.stepSequence[variant.stepSequence.length - 1];
      if (!lastStepId || config.steps[lastStepId]?.type !== 'result') {
        ctx.addIssue({
          code: 'custom',
          path: ['experiment', 'variants', key, 'stepSequence'],
          message: 'stepSequence must end on a result step',
        });
      }

      const misplacedResult = variant.stepSequence
        .slice(0, -1)
        .find((stepId) => config.steps[stepId]?.type === 'result');
      if (misplacedResult) {
        ctx.addIssue({
          code: 'custom',
          path: ['experiment', 'variants', key, 'stepSequence'],
          message: `result step "${misplacedResult}" must be the last step of the sequence`,
        });
      }
    }

    if (Object.values(config.experiment.variants).reduce((sum, variant) => sum + variant.weight, 0) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['experiment', 'variants'], message: 'at least one variant needs a positive weight' });
    }

    config.resultRules.forEach((rule, index) => {
      if (!resultIds.has(rule.resultId)) {
        ctx.addIssue({ code: 'custom', path: ['resultRules', index, 'resultId'], message: `unknown result "${rule.resultId}"` });
      }
    });

    if (!resultIds.has(config.defaultResultId)) {
      ctx.addIssue({ code: 'custom', path: ['defaultResultId'], message: `unknown result "${config.defaultResultId}"` });
    }

    const eventNames = new Set(config.events.allowed.map((event) => event.name));
    for (const required of ['session_started', 'step_viewed', 'answer_submitted', 'step_completed', 'back_clicked', 'result_viewed', 'cta_clicked']) {
      if (!eventNames.has(required)) {
        ctx.addIssue({ code: 'custom', path: ['events', 'allowed'], message: `event "${required}" must be declared` });
      }
    }
  });

export type FunnelConfig = z.infer<typeof funnelConfigSchema>;

export const parseFunnelConfig = (input: unknown): FunnelConfig => funnelConfigSchema.parse(input);
export const safeParseFunnelConfig = (input: unknown) => funnelConfigSchema.safeParse(input);
