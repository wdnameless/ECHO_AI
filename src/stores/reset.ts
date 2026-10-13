type ResetFn = () => void;

const storeResetFns = new Set<ResetFn>();

export function registerStoreReset(fn: ResetFn): () => void {
  storeResetFns.add(fn);
  return () => {
    storeResetFns.delete(fn);
  };
}

export function resetAllStores(): void {
  for (const reset of storeResetFns) {
    reset();
  }
}
