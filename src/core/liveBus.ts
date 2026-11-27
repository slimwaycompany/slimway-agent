import { EventEmitter } from 'events';

export interface LiveEvent { topic: string; id?: string; action?: string; by?: string; }

const bus = new EventEmitter();
bus.setMaxListeners(300);

export function emitLive(e: LiveEvent): void {
  bus.emit('live', e);
}

export { bus as liveBus };
