type QueuedEvent = {
  event_id: string;
  session_id: string;
  type: string;
  step_id: string | null;
  client_ts: string;
  seq: number;
  props?: Record<string, unknown>;
};

const STORAGE_KEY = 'funnel.event_queue';
const FLUSH_INTERVAL = 2000;
const MAX_BATCH = 25;

let queue: QueuedEvent[] = [];
let sessionId: string | null = null;
let seq = 0;
let timer: number | null = null;
let flushing = false;

const readStorage = (): QueuedEvent[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    return [];
  }
};

const writeStorage = (): void => {
  try {
    if (queue.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {}
};

const send = async (batch: QueuedEvent[]): Promise<boolean> => {
  try {
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: batch.length <= 20,
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const flush = async (): Promise<void> => {
  if (flushing || queue.length === 0) return;
  flushing = true;

  try {
    while (queue.length > 0) {
      const batch = queue.slice(0, MAX_BATCH);
      const ok = await send(batch);
      if (!ok) break;
      queue = queue.slice(batch.length);
      writeStorage();
    }
  } finally {
    flushing = false;
  }
};

const scheduleFlush = (): void => {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL);
};

export const initTracker = (id: string): void => {
  const restored = readStorage();
  sessionId = id;
  queue = restored.filter((event) => typeof event?.event_id === 'string');
  seq = queue.reduce((max, event) => Math.max(max, event.seq ?? 0), 0);
  if (queue.length > 0) void flush();
};

export const track = (type: string, stepId: string | null = null, props?: Record<string, unknown>): void => {
  if (!sessionId) return;
  seq += 1;

  queue.push({
    event_id: crypto.randomUUID(),
    session_id: sessionId,
    type,
    step_id: stepId,
    client_ts: new Date().toISOString(),
    seq,
    ...(props ? { props } : {}),
  });

  writeStorage();

  if (queue.length >= MAX_BATCH) void flush();
  else scheduleFlush();
};

export const flushOnUnload = (): void => {
  if (queue.length === 0) return;
  try {
    const blob = new Blob([JSON.stringify({ events: queue.slice(0, MAX_BATCH) })], {
      type: 'application/json',
    });
    navigator.sendBeacon('/api/events', blob);
  } catch {}
};
