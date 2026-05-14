import { resolve } from "node:path";

const IDLE_PRUNE_MS = 60_000;

type QueueState = {
  chain: Promise<void>;
  /** Jobs waiting behind the active runner. */
  waiting: number;
  active: boolean;
  lastUsed: number;
  pruneTimer?: ReturnType<typeof setTimeout>;
};

const queues = new Map<string, QueueState>();

function cancelPrune(state: QueueState): void {
  if (state.pruneTimer !== undefined) {
    clearTimeout(state.pruneTimer);
    state.pruneTimer = undefined;
  }
}

function schedulePrune(key: string, state: QueueState): void {
  cancelPrune(state);
  state.pruneTimer = setTimeout(() => {
    const current = queues.get(key);
    if (current === state && !current.active && current.waiting === 0) {
      queues.delete(key);
    }
  }, IDLE_PRUNE_MS);
}

function getOrCreateQueue(key: string): QueueState {
  let state = queues.get(key);
  if (!state) {
    state = { chain: Promise.resolve(), waiting: 0, active: false, lastUsed: Date.now() };
    queues.set(key, state);
    return state;
  }
  state.lastUsed = Date.now();
  cancelPrune(state);
  return state;
}

/** Total jobs in flight or waiting (active runner + waiters). */
export function getDeployQueueDepth(repoPath: string): number {
  const state = queues.get(resolve(repoPath));
  if (!state) return 0;
  return state.waiting + (state.active ? 1 : 0);
}

/**
 * Runs `fn` when this caller's turn arrives on the FIFO queue for `repoPath`.
 * Concurrent callers on the same repo run strictly one at a time.
 */
export async function enqueueDeploy<T>(
  repoPath: string,
  fn: () => Promise<T>,
  options?: { onQueued?: (position: number) => void }
): Promise<{ result: T; queuePosition: number }> {
  const key = resolve(repoPath);
  const state = getOrCreateQueue(key);
  const position = state.waiting + (state.active ? 1 : 0) + 1;
  state.waiting++;

  const waitFor = state.chain;
  let release!: () => void;
  state.chain = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });

  options?.onQueued?.(position);

  await waitFor;
  state.waiting--;
  state.active = true;
  state.lastUsed = Date.now();
  cancelPrune(state);

  try {
    return { result: await fn(), queuePosition: position };
  } finally {
    state.active = false;
    state.lastUsed = Date.now();
    release();
    if (!state.active && state.waiting === 0) {
      schedulePrune(key, state);
    }
  }
}
