/** Development diagnostics posted by the game for the engine check (#13); protocol messages replace them in #14. */
export interface GameDiagnostics {
  type: 'diagnostics';
  ready: boolean;
  renderer: 'webgl' | 'none';
  zoom: number;
  canvas: { width: number; height: number } | null;
  cspViolations: string[];
}
