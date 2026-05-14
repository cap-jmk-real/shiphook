import { resolve } from "node:path";

type QueueState = {
  chain: Promise<void>;
  /** Jobs waiting behind the active runner. */
  waiting: number;
  active: boolean;
};

const queues = new Map<string, QueueState>();

function getOrCreateQueue(repoPath: string): QueueState {
  const key = resolve(repoPath);
  let state = queues.get(key);
  if (!state) {
    state = { chain: Promise.resolve(), waiting: 0, active: false };
    queues.set(key, state);
  }
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
  const state = getOrCreateQueue(repoPath);
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

  try {
    return { result: await fn(), queuePosition: position };
  } finally {
    state.active = false;
    release();
  }
}
