export type Listener<T> = (payload: T) => void;

export class SimpleEvent<T> {
  private listeners = new Set<Listener<T>>();
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.off(listener);
  }
  off(listener: Listener<T>): void {
    this.listeners.delete(listener);
  }
  emit(payload: T): void {
    for (const l of this.listeners) l(payload);
  }
  clear(): void {
    this.listeners.clear();
  }
}
