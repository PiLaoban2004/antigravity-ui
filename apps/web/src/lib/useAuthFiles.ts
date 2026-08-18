import { useEffect, useState } from 'react';
import type { AuthFile } from '@antigravity-ui/shared';

const EVENTS_URL = 'http://127.0.0.1:4310/api/events';

/** Subscribe to server-sent auth-files snapshots (auto refresh every ~5s). */
export function useAuthFiles() {
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(EVENTS_URL);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('auth-files', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (Array.isArray(data.files)) setFiles(data.files);
      } catch {
        // ignore malformed frame
      }
    });
    return () => es.close();
  }, []);

  return { files, connected };
}
