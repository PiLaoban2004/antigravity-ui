import { createContext, useContext } from 'react';
import type { SessionRole } from '@antigravity-ui/shared';

export type Role = SessionRole;

export interface SessionState {
  /** false = loopback-only local mode (no login, everything allowed). */
  remote: boolean;
  role: Role;
  logout: () => void;
}

export const SessionContext = createContext<SessionState>({ remote: false, role: 'admin', logout: () => {} });

export const useSession = () => useContext(SessionContext);
export const useCanWrite = () => useSession().role === 'admin';
