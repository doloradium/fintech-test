import { z } from 'zod';

export type AnswerValue = string | number | boolean | string[] | null;

export type Condition =
  | { op: 'always' }
  | { op: 'eq'; step: string; value: string | number | boolean }
  | { op: 'neq'; step: string; value: string | number | boolean }
  | { op: 'in'; step: string; values: Array<string | number | boolean> }
  | { op: 'includes'; step: string; value: string }
  | { op: 'includesAny'; step: string; values: string[] }
  | { op: 'countGte'; step: string; value: number }
  | { op: 'gt'; step: string; value: number }
  | { op: 'gte'; step: string; value: number }
  | { op: 'lt'; step: string; value: number }
  | { op: 'lte'; step: string; value: number }
  | { op: 'answered'; step: string }
  | { op: 'and'; conditions: Condition[] }
  | { op: 'or'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

const primitive = z.union([z.string(), z.number(), z.boolean()]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('always') }),
    z.object({ op: z.literal('eq'), step: z.string(), value: primitive }),
    z.object({ op: z.literal('neq'), step: z.string(), value: primitive }),
    z.object({ op: z.literal('in'), step: z.string(), values: z.array(primitive).min(1) }),
    z.object({ op: z.literal('includes'), step: z.string(), value: z.string() }),
    z.object({ op: z.literal('includesAny'), step: z.string(), values: z.array(z.string()).min(1) }),
    z.object({ op: z.literal('countGte'), step: z.string(), value: z.number() }),
    z.object({ op: z.literal('gt'), step: z.string(), value: z.number() }),
    z.object({ op: z.literal('gte'), step: z.string(), value: z.number() }),
    z.object({ op: z.literal('lt'), step: z.string(), value: z.number() }),
    z.object({ op: z.literal('lte'), step: z.string(), value: z.number() }),
    z.object({ op: z.literal('answered'), step: z.string() }),
    z.object({ op: z.literal('and'), conditions: z.array(conditionSchema).min(1) }),
    z.object({ op: z.literal('or'), conditions: z.array(conditionSchema).min(1) }),
    z.object({ op: z.literal('not'), condition: conditionSchema }),
  ]),
);

export type Answers = Record<string, AnswerValue | undefined>;

const asNumber = (value: AnswerValue | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const asArray = (value: AnswerValue | undefined): string[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
};

const isAnswered = (value: AnswerValue | undefined): boolean => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

export const evaluateCondition = (condition: Condition, answers: Answers): boolean => {
  switch (condition.op) {
    case 'always':
      return true;
    case 'eq':
      return answers[condition.step] === condition.value;
    case 'neq':
      return isAnswered(answers[condition.step]) && answers[condition.step] !== condition.value;
    case 'in':
      return condition.values.some((candidate) => candidate === answers[condition.step]);
    case 'includes':
      return asArray(answers[condition.step]).includes(condition.value);
    case 'includesAny':
      return condition.values.some((candidate) => asArray(answers[condition.step]).includes(candidate));
    case 'countGte':
      return asArray(answers[condition.step]).length >= condition.value;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = asNumber(answers[condition.step]);
      if (left === null) return false;
      if (condition.op === 'gt') return left > condition.value;
      if (condition.op === 'gte') return left >= condition.value;
      if (condition.op === 'lt') return left < condition.value;
      return left <= condition.value;
    }
    case 'answered':
      return isAnswered(answers[condition.step]);
    case 'and':
      return condition.conditions.every((child) => evaluateCondition(child, answers));
    case 'or':
      return condition.conditions.some((child) => evaluateCondition(child, answers));
    case 'not':
      return !evaluateCondition(condition.condition, answers);
  }
};

export { isAnswered };
