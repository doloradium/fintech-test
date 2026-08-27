import {
  contentSchema,
  resultSchema,
  stepSchema,
  type EventDefinition,
  type FunnelConfig,
  type FunnelResult,
  type ResultRule,
  type Step,
  type StepType,
  type VariantKey,
} from './funnel-config.js';
import { evaluateCondition, isAnswered, isDecidable, type AnswerValue, type Answers } from './conditions.js';

export type ResolvedFunnel = {
  funnelId: string;
  title: string;
  description: string;
  locale: string;
  experimentId: string;
  variant: VariantKey;
  variantKeys: VariantKey[];
  overrideQueryParam: string;
  steps: Step[];
  results: Record<string, FunnelResult>;
  resultRules: ResultRule[];
  defaultResultId: string;
  progress: { countVisibleOnly: boolean; excludeTypes: StepType[] };
  session: { ttlHours: number; persistAnswers: boolean; pinVersion: boolean; pinExperimentVariant: boolean };
  events: { baseProperties: string[]; allowed: EventDefinition[]; privacy: { storeRawAnswers: boolean; allowAnswerKinds: boolean } };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const mergeStep = (base: Step, override: Record<string, unknown>): Step => {
  if (Object.keys(override).length === 0) return base;

  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>), ...override };

  if (override.content) merged.content = contentSchema.parse({ ...base.content, ...asRecord(override.content) });
  if (override.input) merged.input = { ...base.input, ...asRecord(override.input) };
  if (override.validation) {
    const validationOverride = asRecord(override.validation);
    merged.validation = {
      ...base.validation,
      ...validationOverride,
      messages: { ...(base.validation?.messages ?? {}), ...asRecord(validationOverride.messages) },
    };
  }

  return stepSchema.parse(merged);
};

const mergeResult = (base: FunnelResult, override: Record<string, unknown>): FunnelResult => {
  if (Object.keys(override).length === 0) return base;

  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>), ...override };
  if (override.cta) merged.cta = { ...base.cta, ...asRecord(override.cta) };

  return resultSchema.parse(merged);
};

export const resolveVariant = (config: FunnelConfig, variantKey: VariantKey): ResolvedFunnel => {
  const variant = config.experiment.variants[variantKey];
  if (!variant) throw new Error(`variant "${variantKey}" is not defined in this funnel version`);

  const steps = variant.stepSequence.map((stepId) => {
    const base = config.steps[stepId];
    if (!base) throw new Error(`variant "${variantKey}" references unknown step "${stepId}"`);
    return mergeStep(base, variant.stepOverrides[stepId] ?? {});
  });

  const results: Record<string, FunnelResult> = {};
  for (const [id, base] of Object.entries(config.results)) {
    results[id] = mergeResult(base, variant.resultOverrides[id] ?? {});
  }

  return {
    funnelId: config.funnelId,
    title: config.title,
    description: config.description,
    locale: config.locale,
    experimentId: config.experiment.id,
    variant: variantKey,
    variantKeys: Object.keys(config.experiment.variants),
    overrideQueryParam: config.experiment.overrideQueryParam,
    steps,
    results,
    resultRules: config.resultRules,
    defaultResultId: config.defaultResultId,
    progress: config.progress,
    session: config.session,
    events: config.events,
  };
};

export const visibleSteps = (funnel: ResolvedFunnel, answers: Answers): Step[] =>
  funnel.steps.filter((step) => !step.visibleWhen || evaluateCondition(step.visibleWhen, answers));

export const visibleStepIds = (funnel: ResolvedFunnel, answers: Answers): string[] =>
  visibleSteps(funnel, answers).map((step) => step.id);

export const firstStepId = (funnel: ResolvedFunnel, answers: Answers = {}): string => {
  const first = visibleSteps(funnel, answers)[0] ?? funnel.steps[0];
  if (!first) throw new Error('the resolved funnel has no steps');
  return first.id;
};

export const resultStepId = (funnel: ResolvedFunnel): string | null =>
  funnel.steps.find((step) => step.type === 'result')?.id ?? null;

export const getNextStepId = (funnel: ResolvedFunnel, currentStepId: string, answers: Answers): string => {
  const visible = visibleSteps(funnel, answers);
  const index = visible.findIndex((step) => step.id === currentStepId);
  if (index === -1) return visible[0]?.id ?? currentStepId;
  return visible[index + 1]?.id ?? currentStepId;
};

export const getPreviousStepId = (funnel: ResolvedFunnel, currentStepId: string, answers: Answers): string | null => {
  const visible = visibleSteps(funnel, answers);
  const index = visible.findIndex((step) => step.id === currentStepId);
  if (index <= 0) return null;
  return visible[index - 1]?.id ?? null;
};

export const mayBecomeVisible = (step: Step, answers: Answers): boolean =>
  !step.visibleWhen || !isDecidable(step.visibleWhen, answers) || evaluateCondition(step.visibleWhen, answers);

export const isCountedStep = (funnel: ResolvedFunnel, step: Step): boolean =>
  !funnel.progress.excludeTypes.includes(step.type);

export const countedSteps = (funnel: ResolvedFunnel, answers: Answers): Step[] =>
  funnel.steps.filter(
    (step) =>
      isCountedStep(funnel, step) && (!funnel.progress.countVisibleOnly || mayBecomeVisible(step, answers)),
  );

const answersBefore = (funnel: ResolvedFunnel, answers: Answers, cutoff: number): Answers => {
  const scoped: Answers = {};
  funnel.steps.forEach((step, index) => {
    if (index < cutoff && answers[step.id] !== undefined) scoped[step.id] = answers[step.id];
  });
  return scoped;
};

export const computeProgress = (
  funnel: ResolvedFunnel,
  answers: Answers,
  currentStepId: string,
): { index: number; total: number; ratio: number; path: string[]; counted: boolean } => {
  const path = visibleStepIds(funnel, answers);
  const cutoff = funnel.steps.findIndex((step) => step.id === currentStepId);
  const current = cutoff === -1 ? undefined : funnel.steps[cutoff];

  if (!current) return { index: 0, total: countedSteps(funnel, answers).length, ratio: 0, path, counted: false };

  const counted = countedSteps(funnel, answersBefore(funnel, answers, cutoff));
  const total = counted.length;
  const index = counted.filter((step) => funnel.steps.indexOf(step) < cutoff).length;
  const ratio = total === 0 ? 1 : Math.min(index / total, 1);

  return { index, total, ratio, path, counted: isCountedStep(funnel, current) };
};

export const resolveResultId = (funnel: ResolvedFunnel, answers: Answers): string => {
  for (const rule of funnel.resultRules) {
    if (evaluateCondition(rule.when, answers) && funnel.results[rule.resultId]) return rule.resultId;
  }
  return funnel.defaultResultId;
};

export const resolveResult = (funnel: ResolvedFunnel, answers: Answers): FunnelResult => {
  const id = resolveResultId(funnel, answers);
  const result = funnel.results[id] ?? funnel.results[funnel.defaultResultId];
  if (!result) throw new Error('the funnel version has no usable result screen');
  return result;
};

export const answerKind = (step: Step): string => step.type;

const message = (step: Step, key: string, fallback: string): string =>
  step.validation?.messages?.[key] ?? fallback;

export const validateAnswer = (step: Step, value: AnswerValue | undefined): string | null => {
  if (step.type === 'info' || step.type === 'result') return null;

  const required = step.validation?.required ?? false;

  if (step.type === 'multi-select') {
    const selected = Array.isArray(value) ? value : [];
    const min = step.validation?.minSelections ?? (required ? 1 : undefined);
    const max = step.validation?.maxSelections;
    const allowed = new Set((step.input?.options ?? []).map((option) => option.value));

    if (min !== undefined && selected.length < min) {
      return message(step, 'minSelections', message(step, 'required', `Choose at least ${min}.`));
    }
    if (max !== undefined && selected.length > max) {
      return message(step, 'maxSelections', `Choose no more than ${max}.`);
    }
    if (!selected.every((item) => allowed.has(item))) {
      return message(step, 'invalid', 'One of the selected options is unknown.');
    }
    return null;
  }

  if (!isAnswered(value)) {
    return required ? message(step, 'required', 'This answer is required.') : null;
  }

  if (step.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return message(step, 'invalid', 'Enter a number.');
    const { min, max, step: increment } = step.input ?? {};
    if (min !== undefined && parsed < min) return message(step, 'min', `Enter a value of at least ${min}.`);
    if (max !== undefined && parsed > max) return message(step, 'max', `Enter a value up to ${max}.`);
    if (increment !== undefined && increment > 0) {
      const base = min ?? 0;
      const ratio = (parsed - base) / increment;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        return message(
          step,
          'step',
          increment === 1 ? 'Enter a whole number.' : `Enter a value in increments of ${increment}.`,
        );
      }
    }
    return null;
  }

  const allowed = new Set((step.input?.options ?? []).map((option) => option.value));

  if (typeof value !== 'string') return message(step, 'invalid', 'Select one of the options.');
  return allowed.has(value) ? null : message(step, 'invalid', 'Select one of the options.');
};

export const normalizeAnswer = (step: Step, value: AnswerValue | undefined): AnswerValue => {
  if (step.type === 'info' || step.type === 'result') return true;
  if (step.type === 'number') {
    if (!isAnswered(value)) return null;
    return typeof value === 'number' ? value : Number(value);
  }
  if (step.type === 'multi-select') return Array.isArray(value) ? [...value] : [];
  return value ?? null;
};
