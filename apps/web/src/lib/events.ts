import type { AuthFile } from '@antigravity-ui/shared';

/**
 * One EventSource for the whole app. The server pushes the same auth-files snapshot to every viewer, so
 * pages share a single connection instead of each opening its own (relative URL: works through the Vite
 * proxy, a tunnel, or the server serving the built UI).
 */
type Listener = (files: AuthFile[]) => void;
type StateListener = (connected: boolean) => void;

const EVENTS_URL = '/api/events';

let es: EventSource | null = null;
let last: AuthFile[] | null = null;
let connected = false;
const listeners = new Set<Listener>();
const stateListeners = new Set<StateListener>();

function setConnected(v: boolean) {
  connected = v;
  stateListeners.forEach((l) => l(v));
}

function open() {
  if (es) return;
  es = new EventSource(EVENTS_URL);
  es.onopen = () => setConnected(true);
  es.onerror = () => setConnected(false);
  es.addEventListener('auth-files', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      if (Array.isArray(data.files)) {
        last = data.files;
        listeners.forEach((l) => l(data.files));
      }
    } catch {
      // ignore malformed frame
    }
  });
}

function closeIfIdle() {
  if (listeners.size || stateListeners.size || !es) return;
  es.close();
  es = null;
  connected = false;
}

export function subscribeAuthFiles(onFiles: Listener, onState: StateListener): () => void {
  listeners.add(onFiles);
  stateListeners.add(onState);
  open();
  if (last) onFiles(last);
  onState(connected);
  return () => {
    listeners.delete(onFiles);
    stateListeners.delete(onState);
    closeIfIdle();
  };
}
