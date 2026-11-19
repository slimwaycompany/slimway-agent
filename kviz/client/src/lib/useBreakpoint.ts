import { useState, useEffect } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

function get(): Breakpoint {
  const w = window.innerWidth;
  if (w <= 640) return 'phone';
  if (w <= 1024) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(get);
  useEffect(() => {
    const h = () => setBp(get());
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return bp;
}
