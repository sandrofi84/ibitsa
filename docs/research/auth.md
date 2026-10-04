# Research: Signing in with an API key vs a Claude subscription

Ticket: [#4](https://github.com/sandrofi84/ibitsa/issues/4). Spec: [§11.6 Security and permissions](../SPEC.md#116-security-and-permissions).
Researched: 2026-10-04. All quotes were fetched that day. **This is not legal advice.** Anthropic changes these pages often, so check them again before release (M10).

## Question

Can a published third-party VS Code extension let its users run the Agent SDK with their Claude subscription (Pro/Max sign-in), or must it use an Anthropic API key? What do Anthropic's terms and the SDK docs say? What does each option mean for local development of M1?

## Answer

- **Published extension (M10 and later):** use an API key, or a cloud provider credential (Bedrock, Vertex, Foundry), supplied by each user. The Agent SDK docs say plainly that third-party developers may not offer claude.ai login unless Anthropic has approved it first. Building our own "Sign in with Claude" flow, or handling claude.ai tokens in any way, is clearly forbidden.
- **Developer running M1 locally:** using your own Pro/Max login through the Agent SDK for personal development and experimentation is a use Anthropic recognizes and has encouraged. It is billed against your plan's usage limits. Keep an API key path working anyway, because that is what users will need.
- **Grey area, not resolved:** a published extension that never shows a login of its own, but lets the bundled Claude Code binary pick up a subscription login the user already made in Claude Code. One Anthropic page treats "third-party apps that authenticate with your Claude subscription through the Agent SDK" as a real usage category. The developer docs still say "unless previously approved". To support this, get written confirmation from Anthropic (contact sales).
- **Recommendation:** keep §11.6 as written. v1 uses the user's own API key, and the extension does not offer subscription sign-in. While developing M1, the developer may use his own subscription login or a personal API key. The SDK adapter should take its credential from the environment or settings and never hard-code an auth method.

## Sources and exact text

### 1. Agent SDK overview and quickstart (the developer docs)

[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), "Get started" note (page has no date; fetched 2026-10-04):

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.

The [quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart), "Set your API key" step, has the same note. It lists the supported methods: `ANTHROPIC_API_KEY` from the Claude Console, and the cloud providers (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`).

The overview's "License and terms" section:

> Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users […]

Branding rules from the same page also apply to Ibitsa. "Claude Agent" or "{YourAgentName} Powered by Claude" are allowed. "Claude Code" or "Claude Code Agent" are not, and neither is Claude Code-styled ASCII art. The product "should maintain its own branding and not appear to be Claude Code or any Anthropic product."

### 2. Claude Code "Legal and compliance" page

[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), "Authentication and credential use" (no date on the page; fetched 2026-10-04):

> **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications.
>
> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.

> This does not restrict how customers provision and manage their own API keys […] Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.

> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

Same page, "Acceptable use":

> Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

Same page, "Can customers offer Claude Code in their products?" (this covers products that preinstall or run Claude Code, under the Commercial Terms):

> **The Claude Code binary must not be modified.** […] customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
>
> **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential […]

Earlier versions of this page used stricter wording. As quoted by [The Register, 2026-02-20](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546) (secondary source; the old page text could not be retrieved): "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted." The current page no longer contains that sentence.

### 3. Claude Code Authentication page (how the SDK actually picks a credential)

[Authentication](https://code.claude.com/docs/en/authentication) (fetched 2026-10-04):

> `apiKeyHelper`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` apply to the CLI and the surfaces that wrap it, including the VS Code extension, the Agent SDK, and GitHub Actions.

When several credentials exist, the order of precedence is: cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) → Anthropic profile → "Subscription OAuth credentials from `/login`." The `setup-token` token "authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan."

What this means in practice: the SDK runs the Claude Code binary, and that binary falls back to whatever subscription login is stored on the machine. Unless the extension sets an API key, a user who has logged in to Claude Code will run on their subscription without doing anything.

### 4. Help Center: "Use the Claude Agent SDK with your Claude plan"

[support.claude.com/en/articles/15036540](https://support.claude.com/en/articles/15036540) (pause notice dated "Update June 15"; fetched 2026-10-04):

> Update June 15: We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits. […] We're working to update the plan to better support how users build with Claude subscriptions. When we have an update, we'll share it before anything takes effect.

The paused plan, kept on the page "for reference", said a monthly credit would cover:

> Claude Agent SDK usage in your own projects (Python or TypeScript)
> The claude -p command in Claude Code (non-interactive mode)
> The Claude Code GitHub Actions integration
> Third-party apps that authenticate with your Claude subscription through the Agent SDK

and:

> The Agent SDK monthly credit is sized for individual experimentation and automation. Teams running shared production automation should use Claude Platform with an API key for predictable pay-as-you-go billing.

### 5. Consumer Terms (these apply to Free/Pro/Max users)

[Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms), effective 2025-10-08. Prohibited uses include:

> Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.

> You may not share your Account login information, Anthropic API key, or Account credentials with anyone else or make your Account available to anyone else.

The Legal and compliance page says Free/Pro/Max use of Claude Code falls under these terms, and Team/Enterprise/API use falls under the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms).

### 6. Statements from Anthropic staff and emails (found through secondary reporting)

- January 2026, Thariq Shihipar (Anthropic) on X, as quoted by [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546): "Third-party harnesses using Claude subscriptions create problems for users and are prohibited by our Terms of Service."
- February 2026, Thariq again, as reported by [PiunikaWeb](https://piunikaweb.com/2026/02/19/anthropic-claude-max-ban-agent-sdk-clarification/): the stricter docs wording was "a docs clean up we rolled out that's caused some confusion"; "nothing about Agent SDK usage with Max subscriptions is actually changing"; and "We want to encourage local development and experimentation with the Agent SDK and claude -p." I could not open the original X post.
- 2026-04-04, Anthropic email to customers, as quoted by [TechCrunch](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/): subscribers would "no longer be able to use your Claude subscription limits for third-party harnesses including OpenClaw", and would instead pay through "a pay-as-you-go option billed separately from your subscription." The June 15 notice in source 4 later says third-party app usage "still draw[s] from your subscription's usage limits", so the April rule appears to have been replaced. How the two fit together is not clear (see open questions).

## What this means for Ibitsa

| | Published extension (Marketplace / Open VSX) | Developer building M1 locally |
|-|-|-|
| User's own Anthropic API key (or Bedrock/Vertex/Foundry credential) | **Allowed and recommended.** Billed to the key's owner. Commercial Terms apply. | Allowed. Costs money per token. |
| Extension shows its own "Sign in with Claude" / collects claude.ai tokens | **Not allowed** ("may not collect, store, or intermediate Claude.ai credentials"; "does not permit third-party developers to offer Claude.ai login"). | Not applicable. |
| Extension uses a subscription login the user already made in Claude Code (stored `/login` or `CLAUDE_CODE_OAUTH_TOKEN`) | **Ambiguous.** Not allowed "unless previously approved" according to the SDK docs, but the Help Center lists "third-party apps that authenticate with your Claude subscription through the Agent SDK" as a usage category. Get written confirmation before shipping. | **Allowed in practice.** "Ordinary, individual usage of … the Agent SDK"; "Claude Agent SDK usage in your own projects"; staff said "encourage local development and experimentation." Counts against plan limits. |
| Developer's key or login shared with users | Not allowed (no reselling or intermediating; no sharing credentials). | Not applicable. |

Effects on M1:
- Tests use `agent-fake` (§13), so they spend no tokens and need no credential.
- F5 integration runs can use the developer's Pro/Max login, or a personal Console API key for exact per-token cost tracking. If `ANTHROPIC_API_KEY` is set in the Extension Development Host's environment, it takes priority over the subscription login.
- Design the adapter so the credential comes from the user's settings or environment (and SecretStorage for a pasted API key). Never write a login flow of our own.

## Open questions

1. Can a published extension rely on a subscription login the user made separately in Claude Code, given that it never shows a login itself? The docs and the Help Center point in different directions. Only Anthropic can answer this ("For questions about permitted authentication methods for your use case, please contact sales").
2. Does an extension that runs the Agent SDK count as "preinstalling or running Claude Code in your products"? If it does, the "Can customers offer Claude Code" section would let end users "authenticate with their own … Claude subscription plan credentials". That reading conflicts with the SDK-specific note. I did not rely on it.
3. Billing for SDK/third-party use on subscriptions was paused on 2026-06-15 and Anthropic has promised an update. Check source 4 again before release.
4. I could not open the original X posts or the April 4 email. Those quotes rely on the news reports linked above.
