import { createHash, randomUUID } from 'node:crypto';
import type { FunnelConfig, VariantKey } from '@funnel/shared';

export const checksum = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export const newId = (): string => randomUUID();

const bucketOf = (input: string): number => {
  const digest = createHash('sha256').update(input).digest();
  const slice = digest.subarray(0, 4);
  return slice.readUInt32BE(0) % 10_000;
};

export const assignVariant = (config: FunnelConfig, sessionId: string, salt: string): VariantKey => {
  const weighted = config.variants.filter((variant) => variant.weight > 0);
  const pool = weighted.length > 0 ? weighted : config.variants;
  const total = pool.reduce((sum, variant) => sum + Math.max(variant.weight, 0), 0);
  if (total <= 0) return pool[0]?.key ?? 'A';

  const bucket = bucketOf(`${salt}:${config.experiment.key}:${sessionId}`) / 10_000;
  let cursor = 0;

  for (const variant of pool) {
    cursor += Math.max(variant.weight, 0) / total;
    if (bucket < cursor) return variant.key;
  }

  return pool[pool.length - 1]?.key ?? 'A';
};
