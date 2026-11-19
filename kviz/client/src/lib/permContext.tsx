import { createContext, useContext } from 'react';

export interface PermEntry { level: 'view' | 'edit'; see_all: boolean }

interface PermContextValue {
  role: string;
  perms: Record<string, PermEntry>;
}

export const PermContext = createContext<PermContextValue>({ role: '', perms: {} });

export function usePerm(key: string, level: 'view' | 'edit' = 'view'): boolean {
  const { role, perms } = useContext(PermContext);
  if (role === 'admin') return true;
  const p = perms[key];
  if (!p) return false;
  return level === 'view' ? true : p.level === 'edit';
}

export function useSeeAll(key: string): boolean {
  const { role, perms } = useContext(PermContext);
  if (role === 'admin') return true;
  return Boolean(perms[key]?.see_all);
}

export function useRole(): string {
  return useContext(PermContext).role;
}
