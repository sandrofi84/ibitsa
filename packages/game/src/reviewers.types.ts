/** A reviewing councillor on the map (§5.5, §7.2, #140): one per councillor per round of a task's review. */
export interface ReviewerView {
  /** Task, councillor and round: a councillor reviewing again later is a new walk out. */
  key: string;
  taskPointId: string;
  councillorId: string;
  round: number;
  status: 'running' | 'done' | 'failed';
  /** Blocking findings in its verdict; 0 for a pass or while running. */
  findings: number;
  /** The round is over (passed, sent back or escalated): it walks back to the hut. */
  leaving: boolean;
  /** Its place among the task's reviewers, for where it stands. */
  index: number;
}
