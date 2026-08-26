import { z } from 'zod';
import { conditionSchema, type Condition } from './conditions.js';

export const RESULT_STEP_ID = '@result';

export const transitionSchema = z.object({
  when: conditionSchema.optional(),
  goto: z.string().min(1),
});

export type Transition = { when?: Condition; goto: string };

const optionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const baseStepFields = {
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'step id must be snake_case'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  hint: z.string().optional(),
  next: z.array(transitionSchema).optional(),
};

export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseStepFields,
    type: z.literal('info'),
    body: z.array(z.string()).default([]),
    ctaLabel: z.string().optional(),
  }),
  z.object({
    ...baseStepFields,
    type: z.literal('single_select'),
    options: z.array(optionSchema).min(2),
    required: z.boolean().default(true),
  }),
  z.object({
    ...baseStepFields,
    type: z.literal('multi_select'),
    options: z.array(optionSchema).min(2),
    minSelected: z.number().int().min(0).default(1),
    maxSelected: z.number().int().min(1).optional(),
  }),
  z.object({
    ...baseStepFields,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().default(true),
    unit: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().default(true),
  }),
]);

export type Step = z.infer<typeof stepSchema>;
export type StepType = Step['type'];

export const resultScreenSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  body: z.array(z.string()).default([]),
  cta: z.object({
    id: z.string().min(1).default('primary'),
    label: z.string().min(1),
    href: z.string().min(1).default('#'),
  }),
  secondaryNote: z.string().optional(),
});

export type ResultScreen = z.infer<typeof resultScreenSchema>;

export const variantSchema = z.object({
  key: z.enum(['A', 'B']),
  label: z.string().min(1),
  weight: z.number().int().min(0).default(50),
  stepOrder: z.array(z.string().min(1)).min(1),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  result: z.record(z.string(), z.unknown()).default({}),
});

export type Variant = z.infer<typeof variantSchema>;
export type VariantKey = Variant['key'];

export const funnelConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    funnelId: z.string().min(1),
    name: z.string().min(1),
    experiment: z.object({
      key: z.string().min(1),
      hypothesis: z.string().min(1),
      primaryMetric: z.string().min(1),
    }),
    steps: z.array(stepSchema).min(1),
    result: resultScreenSchema,
    variants: z.array(variantSchema).length(2),
    extraEvents: z.array(z.string().regex(/^[a-z][a-z0-9_]{2,63}$/)).default([]),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    config.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: `duplicate step id "${step.id}"` });
      }
      ids.add(step.id);
    });

    const knownTargets = new Set<string>([...ids, RESULT_STEP_ID]);
    config.steps.forEach((step, index) => {
      step.next?.forEach((transition, transitionIndex) => {
        if (!knownTargets.has(transition.goto)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', index, 'next', transitionIndex, 'goto'],
            message: `unknown transition target "${transition.goto}"`,
          });
        }
      });
    });

    const keys = new Set(config.variants.map((variant) => variant.key));
    if (keys.size !== 2) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'variants must contain exactly one A and one B' });
    }

    config.variants.forEach((variant, index) => {
      if (variant.stepOrder.length < 6) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', index, 'stepOrder'],
          message: 'each variant must expose at least 6 screens',
        });
      }
      variant.stepOrder.forEach((stepId, stepIndex) => {
        if (!ids.has(stepId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['variants', index, 'stepOrder', stepIndex],
            message: `unknown step id "${stepId}"`,
          });
        }
      });
      const seen = new Set<string>();
      variant.stepOrder.forEach((stepId) => seen.add(stepId));
      if (seen.size !== variant.stepOrder.length) {
        ctx.addIssue({ code: 'custom', path: ['variants', index, 'stepOrder'], message: 'stepOrder contains duplicates' });
      }
    });

    if (config.variants.reduce((sum, variant) => sum + variant.weight, 0) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'at least one variant must have a positive weight' });
    }
  });

export type FunnelConfig = z.infer<typeof funnelConfigSchema>;

export const parseFunnelConfig = (input: unknown): FunnelConfig => funnelConfigSchema.parse(input);

export const safeParseFunnelConfig = (input: unknown) => funnelConfigSchema.safeParse(input);
