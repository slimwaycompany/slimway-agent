import { useState, useEffect } from 'react';
import { _registerConfirmHandler } from '../../lib/confirm';
import { ConfirmDialog } from './ConfirmDialog';

interface State { msg: string; resolve: (v: boolean) => void; }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    _registerConfirmHandler((msg: string) => new Promise<boolean>(res => setState({ msg, resolve: res })));
  }, []);

  return (
    <>
      {children}
      {state && (
        <ConfirmDialog
          message={state.msg}
          onConfirm={() => { state.resolve(true); setState(null); }}
          onClose={() => { state.resolve(false); setState(null); }}
        />
      )}
    </>
  );
}
