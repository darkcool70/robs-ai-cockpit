// What you said and where it went: the last voice events, shown in the Voice tab.
import { create } from "zustand";

export interface VoiceEvent {
  ts: number;
  heard: string;
  /** Session name, "Cockpit" for commands, or the operator. */
  to: string;
  /** sent · conversation · typed · held · command · handled · not running · action */
  what: string;
}

export const useVoiceLog = create<{ events: VoiceEvent[] }>(() => ({ events: [] }));

export function logVoice(e: Omit<VoiceEvent, "ts">) {
  useVoiceLog.setState((s) => ({ events: [{ ...e, ts: Date.now() }, ...s.events].slice(0, 40) }));
}
