import { useEffect, useState } from 'react';
import type { AuthFile } from '@antigravity-ui/shared';
import { subscribeAuthFiles } from './events';

/** Subscribe to server-sent auth-files snapshots (shared connection, refreshed server-side every ~5s). */
export function useAuthFiles() {
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => subscribeAuthFiles(setFiles, setConnected), []);

  return { files, connected };
}
