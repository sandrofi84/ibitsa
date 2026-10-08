import type { Cost, Usage } from '@agentclientprotocol/sdk';
import type { MicroUsd } from '@ibitsa/protocol';
import type { AgentPrices } from './acp-adapter.types';

export const ESTIMATE_BASIS = 'tokens × the agent’s prices';

/**
 * A hero's gold from what its agent reports (§11.5): a cost in USD is exact; failing that, token counts
 * times the prices in its `ibitsa.agents` entry are an estimate; otherwise gold stays unknown.
 */
export class GoldMeter {
  private readonly prices: AgentPrices | undefined;
  /** Once the agent reports a cost, estimates stop: the two would disagree. */
  private costReported = false;
  private estimate = 0;

  constructor(prices: AgentPrices | undefined) {
    this.prices = prices;
  }

  /** `usage_update.cost`: the session's running total, exact when it is in USD. */
  reported(cost: Cost | null | undefined): { totalCost: MicroUsd } | null {
    if (cost?.currency.toUpperCase() !== 'USD') return null;
    this.costReported = true;
    return { totalCost: Math.round(cost.amount * 1_000_000) };
  }

  /**
   * A finished turn's token counts (`PromptResponse.usage`, one turn's worth), added to the estimate.
   * Thinking tokens bill as output.
   */
  turn(usage: Usage | null | undefined): { totalCost: MicroUsd; costBasis: string } | null {
    if (!usage || !this.prices || this.costReported) return null;
    const output = usage.outputTokens + (usage.thoughtTokens ?? 0);
    // Per million tokens in USD, so tokens × price is micro-dollars.
    this.estimate +=
      usage.inputTokens * this.prices.inputPerMillion + output * this.prices.outputPerMillion;
    return { totalCost: Math.round(this.estimate), costBasis: ESTIMATE_BASIS };
  }
}
