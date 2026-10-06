/** Arguments that skip the prompts (integration tests, scripts). */
export interface ExportTalliesArgs {
  target: string;
  format: 'json' | 'csv';
}
