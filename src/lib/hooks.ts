// Extension points the Pro edition fills in (see @pro/boot). The open-source build leaves them
// empty, so every caller must cope with a missing hook.

export interface VoiceHooks {
  /** Session of the operator assistant if it is running (the main voice shortcut can talk to it). */
  operatorSession?: () => string | null;
  /** Start the operator if needed; resolves to its running session, or null. */
  ensureOperator?: () => Promise<string | null>;
  /**
   * A message is about to be typed into a session (dictation or chat). Returns the text to send,
   * or null when the message was consumed (e.g. "yes" confirms pending actions).
   */
  beforeSend?: (sessionId: string, text: string, spoken: boolean) => Promise<string | null>;
  /** Text of a finished answer as it should be read aloud (hides action blocks). */
  speechOf?: (sessionId: string, text: string) => string | null;
  /** True while the session will answer again on its own (keep the microphone closed). */
  holdListening?: (sessionId: string) => boolean;
  /**
   * The "📡 Event" this session is answering right now needs the user (a decision, a failure, a watch
   * they set) and has not been said before — then one short sentence is spoken (see speakPolicy).
   */
  eventUrgent?: (sessionId: string) => boolean;
  /** Sessions that read their own answers aloud (the core reader leaves them alone). */
  speaksItself?: (sessionId: string) => boolean;
  /** "Rückgängig" by voice: take back the last change (the board); returns what happened, or null. */
  undo?: () => string | null;
  /** The sentence that is about to be spoken (subtitles on the board). */
  onSpeechPart?: (sessionId: string | null, text: string) => void;
  /** `[[id]]` markers in the sentence that is about to be spoken (the board makes those cards glow). */
  onSpeechMarkers?: (sessionId: string | null, ids: string[]) => void;
  /**
   * A whole spoken utterance before it is routed ("weiter", "zurück", "präsentier das Board" while
   * presenting). Returns true when it was handled; `then` listens again in a conversation.
   */
  spokenCommand?: (text: string, then?: () => void) => boolean;
  /** How long a conversation waits for you to start speaking (ms), when something else than the default fits. */
  listenTimeoutMs?: (sessionId: string) => number | null;
  /** You said nothing in a conversation: true when that was handled (e.g. the next slide); `listen` opens the mic again. */
  onSilence?: (sessionId: string, listen: () => void) => boolean;
  /** Files dropped at (x, y) on the screen: true when something there took them (the board). */
  fileDrop?: (paths: string[], x: number, y: number) => boolean;
}

export const voiceHooks: VoiceHooks = {};
