import {
  RESULT_STEP_ID,
  stepSchema,
  resultScreenSchema,
  type FunnelConfig,
  type ResultScreen,
  type Step,
  type Transition,
  type VariantKey,
} from './funnel-config.js';
import { evaluateCondition, isAnswered, type Answers, type AnswerValue } from './conditions.js';

export type ResolvedFunnel = {
  funnelId: string;
  name: string;
  variant: VariantKey;
  variantLabel: string;
  experiment: FunnelConfig['experiment'];
  steps: Step[];
  result: ResultScreen;
  extraEvents: string[];
};

const mergeShallow = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => ({
  ...base,
  ...patch,
});

export const resolveVariant = (config: FunnelConfig, variantKey: VariantKey): ResolvedFunnel => {
  const variant = config.variants.find((candidate) => candidate.key === variantKey);
  if (!variant) throw new Error(`variant "${variantKey}" is not defined in this funnel version`);

  const byId = new Map(config.steps.map((step) => [step.id, step]));
  const available = new Set(variant.stepOrder);

  const steps = variant.stepOrder.map((stepId) => {
    const base = byId.get(stepId);
    if (!base) throw new Error(`variant "${variantKey}" references unknown step "${stepId}"`);
    const patch = variant.overrides[stepId] ?? {};
    const merged = stepSchema.parse(mergeShallow(base as unknown as Record<string, unknown>, patch));
    const next = merged.next?.filter(
      (transition: Transition) => transition.goto === RESULT_STEP_ID || available.has(transition.goto),
    );
    return (next && next.length > 0 ? { ...merged, next } : { ...merged, next: undefined }) as Step;
  });

  const result = resultScreenSchema.parse(
    mergeShallow(config.result as unknown as Record<string, unknown>, variant.result),
  );

  return {
    funnelId: config.funnelId,
    name: config.name,
    variant: variantKey,
    variantLabel: variant.label,
    experiment: config.experiment,
    steps,
    result,
    extraEvents: config.extraEvents,
  };
};

export const getNextStepId = (steps: Step[], currentStepId: string, answers: Answers): string => {
  const index = steps.findIndex((step) => step.id === currentStepId);
  if (index === -1) return RESULT_STEP_ID;
  const step = steps[index];
  if (!step) return RESULT_STEP_ID;

  for (const transition of step.next ?? []) {
    if (!transition.when || evaluateCondition(transition.when, answers)) return transition.goto;
  }

  return steps[index + 1]?.id ?? RESULT_STEP_ID;
};

export const computePath = (steps: Step[], answers: Answers): string[] => {
  const first = steps[0];
  if (!first) return [];

  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string = first.id;

  while (currentId !== RESULT_STEP_ID) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    path.push(currentId);
    currentId = getNextStepId(steps, currentId, answers);
  }

  return path;
};

export const computeProgress = (
  steps: Step[],
  answers: Answers,
  currentStepId: string,
): { index: number; total: number; ratio: number; path: string[] } => {
  const path = computePath(steps, answers);
  const total = path.length;

  if (currentStepId === RESULT_STEP_ID) return { index: total, total, ratio: 1, path };

  const index = path.indexOf(currentStepId);
  if (index === -1) return { index: 0, total, ratio: total === 0 ? 1 : 0, path };

  return { index, total, ratio: total === 0 ? 1 : index / total, path };
};

export const isStepReachable = (steps: Step[], answers: Answers, stepId: string): boolean =>
  stepId === RESULT_STEP_ID || computePath(steps, answers).includes(stepId);

export const validateAnswer = (step: Step, value: AnswerValue | undefined): string | null => {
  switch (step.type) {
    case 'info':
      return null;
    case 'single_select': {
      if (!isAnswered(value)) return step.required ? 'Выберите один из вариантов' : null;
      if (typeof value !== 'string') return 'Некорректный формат ответа';
      return step.options.some((option) => option.value === value) ? null : 'Такого варианта нет в этом шаге';
    }
    case 'multi_select': {
      const selected = Array.isArray(value) ? value : [];
      if (selected.length < step.minSelected) {
        return step.minSelected === 1
          ? 'Выберите хотя бы один вариант'
          : `Выберите минимум ${step.minSelected} варианта`;
      }
      if (step.maxSelected !== undefined && selected.length > step.maxSelected) {
        return `Можно выбрать не больше ${step.maxSelected} вариантов`;
      }
      const allowed = new Set(step.options.map((option) => option.value));
      return selected.every((item) => allowed.has(item)) ? null : 'В ответе есть неизвестный вариант';
    }
    case 'number': {
      if (!isAnswered(value)) return step.required ? 'Введите значение' : null;
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) return 'Введите число';
      if (step.integer && !Number.isInteger(parsed)) return 'Введите целое число';
      if (step.min !== undefined && parsed < step.min) return `Минимум — ${step.min}`;
      if (step.max !== undefined && parsed > step.max) return `Максимум — ${step.max}`;
      return null;
    }
  }
};

export const normalizeAnswer = (step: Step, value: AnswerValue | undefined): AnswerValue => {
  if (step.type === 'number') {
    if (!isAnswered(value)) return null;
    return typeof value === 'number' ? value : Number(value);
  }
  if (step.type === 'multi_select') return Array.isArray(value) ? [...value] : [];
  if (step.type === 'info') return true;
  return value ?? null;
};
