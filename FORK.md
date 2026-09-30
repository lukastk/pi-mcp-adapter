# myagent native-codemode integration fork

2026-09-30. Owner: lukastk. Branch: `myagent-codemode`. Upstream base:
`c04a24b` (3.3.0 plus four upstream commits, including the `builtin:mcp` detection
fix and opt-in mcpScript). Package version: `3.3.0-myagent.1`.

## Why this fork

Keep upstream's lazy connection, cached discovery, approval, and idle-disconnect
machinery while using Pi's native code mode. Native Pi 0.99.1 connects enabled
MCP servers at startup and has no corresponding idle policy. Rebuilding that
lifecycle in Pi would be substantially broader than these tool-boundary changes.

This is an integration fork, not a second code-mode engine. Pi owns QuickJS,
script storage, nested tool execution/hooks, cancellation, and discovery ranking.
The adapter still owns MCP connections, authorization, metadata caching and UI.

## Patch contract (Pi 0.99.1)

- Selected direct MCP tools advertise an output schema and return the complete
  public MCP result as Pi `structuredContent`. The existing bounded `content`
  remains the model-facing rendering. Scripts can filter results before emitting
  them; they do not receive the rendered/truncated text instead of data.
- Top-level MCP `_meta` is stripped from the script result (app-only data).
- MCP error results resolve with `isError: true`; pre-dispatch/transport failures
  also have explicit error envelopes. Unexpected successful results without
  machine-readable content fail loudly.
- Cached output schemas and annotations reach Pi registration. Tools are grouped
  under namespace `mcp__<server>`; **existing adapter tool names do not change**.
- `directTools: "search"` uses native `deferred` exposure. Native codemode can
  discover/call these tools without first promoting them into model declarations.
  Native `tool_search` activation is respected on subsequent turns.
- Withdrawn/disabled deferred tools are hidden, not merely deactivated (inactive
  deferred tools remain callable in Pi). Reappearing tools can be used again.
- Ordinary direct tools remain direct. Proxy-only tools and resource tools retain
  their existing contracts. No implicit native-MCP server registration bridge or
  full native-manager replacement is claimed.

For zero startup connections with an empty/stale cache, set
`settings.deferWithMissingMetadata: true`. An uncached server necessarily has no
native tool catalog until an explicit `mcp({ connect: "server" })` discovers it.
For our rig, native MCP is disabled via `extensions: ["-builtin:mcp"]` and
`scriptMode: false` selects native codemode rather than exposing mcpScript too.

## Verification

- `npm run typecheck`: passes against Pi 0.99.1.
- `npm run test:public-exports`: 4 passed, including packed-package imports.
- `npm run test:native`: passes using a deterministic local provider, real Pi
  sessions, real stdio MCP, and native QuickJS. No model credentials or browser.
  Proves cold/warm no-spawn discovery, 100,000-character structured payloads,
  private metadata exclusion, error envelopes, approvals, nested permission
  hooks, script cancellation, native search activation, dynamic withdrawal and
  restoration, and actual idle disconnect/reconnect (30-second lifecycle tick).
- Added unit tests cover metadata propagation, error contracts, image-block
  preservation, and unchanged resource behavior.
- Full Vitest run after building the visualizer example: **2,170 passed, 4 failed**
  across 155 files. The same cold-cache child-startup failure and three
  request-header-command helper-cleanup failures reproduce in an unmodified
  `c04a24b` worktree using the same Pi 0.99.1 dependencies. Do not call the whole
  upstream suite green. Those failures are outside this patch and are not skipped
  or patched around here. An earlier HTTP-CA timeout did not reproduce on rerun.

## Maintenance

Rebase/merge upstream deliberately, rerun the integration and lifecycle tests,
and update the exact dev dependencies when validating a new Pi release. Host
packages remain peer dependencies rather than bundled runtime dependencies.
Keep `myagent-codemode` separate from upstream `main`; myagent's installer tracks
that branch. Do not silently overwrite the branch with upstream.

The implementation checkout is the Boxyard box `20260930_vcs2zg__pi-mcp-adapter`.
Do not develop in Pi's installed git checkout: package updates reset/clean it.
No upstream issue or PR was posted as part of this work.
