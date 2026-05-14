export type ToastType = 'success' | 'error';

export interface Toast {
  id: number;
  msg: string;
  type: ToastType;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 0;
const listeners: Set<Listener> = new Set();

function notify() {
  listeners.forEach((l) => l([...toasts]));
}

export function showToast(msg: string, type: ToastType = 'success', duration = 3500) {
  const id = ++nextId;
  toasts = [...toasts, { id, msg, type }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, duration);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}
