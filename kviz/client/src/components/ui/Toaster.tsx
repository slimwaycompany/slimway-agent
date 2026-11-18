import { useState, useEffect, useCallback } from 'react';
import * as T from '@radix-ui/react-toast';
import { _registerToastHandler } from '../../lib/toast';

interface Item { id: number; msg: string; type: 'error' | 'success' | 'info'; }

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  const remove = useCallback((id: number) => setItems(p => p.filter(i => i.id !== id)), []);

  useEffect(() => {
    _registerToastHandler((msg, type) => {
      setItems(p => [...p, { id: Date.now() + Math.random(), msg, type }]);
    });
  }, []);

  return (
    <T.Provider swipeDirection="right">
      {items.map(item => (
        <T.Root key={item.id} open duration={4000} onOpenChange={open => { if (!open) remove(item.id); }}>
          <T.Description className={`ui-toast ui-toast--${item.type}`}>{item.msg}</T.Description>
        </T.Root>
      ))}
      <T.Viewport className="ui-toast-viewport" />
    </T.Provider>
  );
}
