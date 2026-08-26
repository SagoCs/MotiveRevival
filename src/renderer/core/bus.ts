export type Listener<P> = (payload: P) => void;

export class Bus<E extends object> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => {
      set?.delete(fn as Listener<never>);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (set) for (const fn of set) (fn as unknown as Listener<E[K]>)(payload);
  }
}
