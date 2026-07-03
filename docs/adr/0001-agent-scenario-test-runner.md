# ADR 0001: Agent scenario test runner (`newo test`) architecture

Status: accepted (CLI-TEST-1, 2026-07-03)

## Context

The CLI covered sync/edit/poke (`pull`/`push`/`diff`/`sandbox`/`logs`) but had no
repeatable, CI-able way to assert agent behavior - the edit -> push -> verify loop had no
verify. `newo test <scenario.yaml>` closes it: one scripted multi-turn conversation
against a live sandbox agent, per-turn assertions, machine-readable results.

## Decisions

1. **Pure/impure split.** All parsing, validation, assertion, and timeout-precedence
   logic lives in `src/testing/scenario.ts` with zero I/O; `src/cli/commands/test.ts`
   only orchestrates auth, connector resolution, the turn loop, and rendering. The seam
   is what makes the contract exhaustively unit-testable without spawning processes.
2. **First schema-validated YAML input in this repo, hand-rolled.** Validation is
   exhaustive and fail-fast (unknown keys rejected at both levels, regex compiled,
   timeouts checked) and runs before any API call. No ajv/zod dependency - manual checks
   with path-bearing error messages, matching house style.
3. **Reply = all agent acts in the turn's poll window, joined with `\n`.** Asserting only
   the last chat bubble makes `contains` flaky against message splitting, which is
   presentation, not behavior. Made real via an optional `settleMs` parameter on
   `pollForResponse` (`src/sandbox/chat.ts`): default `0` preserves `newo sandbox`'s
   original single-bubble behavior byte-for-byte (its call sites are untouched); `newo
   test` passes a ~1500ms settle window, so once the first agent act arrives polling
   continues, accumulating every distinct agent act seen, until no NEW agent act has
   appeared for that window or the turn's overall timeout is reached - whichever comes
   first - and returns all of them (chronologically ordered) for the join above. Equal
   datetimes use first-seen order as the tie-break: earlier poll wins, and within one poll
   the chat-history response order wins. The settle path also uses stable correlation and
   content fields rather than only platform IDs for deduplication, so missing or duplicated
   IDs do not make distinct bubbles disappear when another stable field, such as
   `external_event_id`, distinguishes them. Synthetic IDs for missing platform IDs exclude
   timestamps because chat-history snapshots can report the same bubble with a shifted
   timestamp across polls. Because this is polling, not a server-side event stream, a bubble
   first observed on the boundary poll can be collected into the current turn; exact
   sub-poll arrival time is not observable.
4. **Timeout is a classified turn status, not an exception** - `pollForResponse`
   deliberately never throws on timeout; the runner classifies `pass|fail|timeout|skipped`
   and fail-fast aborts the scenario (shared conversation state is off-script after a
   divergence), reporting skipped turns rather than dropping them.
5. **`normalizeActEventId` is the single correlation-key guard** (lifted from
   `sandbox.ts` into `sandbox/chat.ts`): the chat-history converter's `'chat_history'`
   placeholder must never be treated as a real `external_event_id` by any reader.
6. **Exit via `process.exit(1)` after the full report prints** - the repo's universal
   convention; fail-fast per scenario means the report is complete before exiting.

## Consequences

- CI budget is bounded by `turns x per-turn timeout` (documented in README); no retries
  by design - a flaky agent should fail its gate, not be retried into passing.
- One sandbox persona/actor pair is created per run and never deleted (no delete endpoint
  exists; same limitation as `newo sandbox`).
- The scenario schema (`contains`/`not_contains`/`regex`, AND semantics, case-sensitive)
  is deliberately minimal; extensions (case-insensitive, semantic assertions,
  continue-on-failure) are explicit non-goals of v1 recorded in the feature docs.
