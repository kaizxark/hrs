/**
 * Global API-busy indicator.
 *
 * A tiny pub/sub store that every tRPC HTTP request notifies (see the
 * wrapped fetch in main.tsx). The TopProgressBar subscribes to it and shows
 * a slim indeterminate bar at the top of the viewport while any request is
 * in flight — so "the site just sits still" moments (mutations especially)
 * always have visible motion.
 */

type Listener = (busyCount: number) => void;

let busyCount = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach(listener => listener(busyCount));
}

/** Called when a request starts. */
export function apiRequestStart() {
  busyCount += 1;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  emit();
}

/** Called when a request settles (success or failure). */
export function apiRequestEnd() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0 && !hideTimer) {
    // Small linger so quick queries don't strobe the bar on and off.
    hideTimer = setTimeout(() => {
      hideTimer = null;
    }, 200);
  }
  emit();
}

export function isApiBusy(): boolean {
  return busyCount > 0;
}

/** Subscribe to busy-state changes. Returns an unsubscribe function. */
export function subscribeApiBusy(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
