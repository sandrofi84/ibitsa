/** Extension → webview messages that are not core messages (#37). */
export type HostEvent =
  /** Whether a hero can start: credentials found, or development mode (spec §11.6). */
  | { channel: 'host'; type: 'credentials'; ready: boolean }
  | { channel: 'host'; type: 'apiKeyAccepted' }
  | { channel: 'host'; type: 'apiKeyRejected'; reason: string }
  /** "Ibitsa: New Quest" from the Command Palette. */
  | { channel: 'host'; type: 'openNewQuest' }
  /** "Ibitsa: Message Hero…" from the Command Palette (#87). */
  | { channel: 'host'; type: 'focusCommandBar' }
  /** "Ibitsa: Run Action…": the chosen action, ready in the bar with its preview (#87). */
  | { channel: 'host'; type: 'fillCommandBar'; text: string };
