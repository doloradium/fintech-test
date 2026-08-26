import { z } from 'zod';

export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue | undefined>;

export const OPERATORS = [
  'eq',
  'neq',
  'in',
  'notIn',
  'contains',
  'containsAny',
  'containsAll',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isAnswered',
  'isEmpty',
] as const;

export type Operator = (typeof OPERATORS)[number];

export type LeafCondition = {
  answer: string;
  operator: Operator;
  value?: unknown;
};

export type Condition =
  | LeafCondition
  | { all: Condition[] }
  | { any: Condition[] }
  | { none: Condition[] }
  | { not: Condition };

const leafSchema = z.object({
  answer: z.string().min(1),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    leafSchema,
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ none: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
  ]),
) as z.ZodType<Condition>;

export const isAnswered = (value: AnswerValue | undefined): boolean => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const toList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const sameScalar = (left: AnswerValue | undefined, right: unknown): boolean => {
  if (left === right) return true;
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  return leftNumber !== null && rightNumber !== null && leftNumber === rightNumber;
};

const evaluateLeaf = (condition: LeafCondition, answers: Answers): boolean => {
  const left = answers[condition.answer];
  const right = condition.value;

  switch (condition.operator) {
    case 'isAnswered':
      return isAnswered(left);
    case 'isEmpty':
      return !isAnswered(left);
    case 'eq':
      return sameScalar(left, right);
    case 'neq':
      return isAnswered(left) && !sameScalar(left, right);
    case 'in':
      return toList(right).some((candidate) => sameScalar(left, candidate));
    case 'notIn':
      return isAnswered(left) && !toList(right).some((candidate) => sameScalar(left, candidate));
    case 'contains':
      return toList(left).some((item) => item === right);
    case 'containsAny':
      return toList(right).some((candidate) => toList(left).includes(candidate));
    case 'containsAll':
      return toList(right).every((candidate) => toList(left).includes(candidate));
    case 'between': {
      const bounds = toList(right);
      const value = toNumber(left);
      const min = toNumber(bounds[0]);
      const max = toNumber(bounds[1]);
      return value !== null && min !== null && max !== null && value >= min && value <= max;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const value = toNumber(left);
      const bound = toNumber(right);
      if (value === null || bound === null) return false;
      if (condition.operator === 'gt') return value > bound;
      if (condition.operator === 'gte') return value >= bound;
      if (condition.operator === 'lt') return value < bound;
      return value <= bound;
    }
  }
};

export const evaluateCondition = (condition: Condition, answers: Answers): boolean => {
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, answers));
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, answers));
  if ('none' in condition) return !condition.none.some((child) => evaluateCondition(child, answers));
  if ('not' in condition) return !evaluateCondition(condition.not, answers);
  return evaluateLeaf(condition, answers);
};
