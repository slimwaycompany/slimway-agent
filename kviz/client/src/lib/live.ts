import { useEffect, useRef } from 'react';

// Receives live-event messages from the shell's SSE relay via postMessage
export function useLive(topics: string[], onChange: () => void): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const topicsKey = topics.join(',');

  useEffect(() => {
    const topicSet = new Set(topics.includes('*') ? [] : topics);

    let debTimer: ReturnType<typeof setTimeout> | null = null;
    function schedule() {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(() => { debTimer = null; cbRef.current(); }, 400);
    }

    function handler(e: MessageEvent) {
      if (!e.data || e.data.type !== 'live') return;
      const msgTopic: string = e.data.topic ?? '';
      if (msgTopic === '*' || topicSet.size === 0 || topicSet.has(msgTopic)) {
        schedule();
      }
    }

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (debTimer) clearTimeout(debTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsKey]);
}
