# Session Chronicle - platform reachability gap and ask

Status: open ask to the NEWO platform team.
Context: `newo session <uuid>` / `newo conversations --session-id <uuid>` (v3.7.6).

## Summary

The CLI can assemble a useful single-session view with an api-key-exchanged
token, but it cannot reproduce the **full** Conversations-UI chronicle. The one
endpoint that returns that formatted chronicle is not reachable with the token
the CLI authenticates with. This document records exactly what is and is not
reachable, why, and what we need from the platform to close the gap.

## What the CLI can reach today (api-key token)

`newo session <uuid>` resolves and assembles the session in two steps that both
work with an api-key-exchanged token:

1. `GET /api/v1/bff/conversations/user-personas?session_id=<uuid>` - server-side
   filters to the persona(s)/actor(s) tied to the session.
2. `GET /api/v1/chat/history?user_actor_id=<id>` - the dialog transcript for each
   resolved (non-service) actor. For some personas this also includes the
   agent's `THOUGHTS:` reasoning lines and system-log rows (booking payloads,
   availability lookups, SMS, the end-of-session summary).

`newo session <uuid> --full` additionally merges the execution trace:

3. `GET /api/v1/analytics/logs?user_actor_ids=<id>&from_datetime=...&to_datetime=...`
   - every NSL/skill call and LLM `Gen`, with `flow_idn`, `skill_idn`, `model`,
   level, and timing - scoped to the resolved actor(s) within the dialog time
   window (padded at the tail by `--pad-end`, default 10 min). Bounded by
   `--max-logs` (default 20000) with a `partial` flag when the cap is hit.

The dialog turns and the log entries are linked by `external_event_id` (chat
items carry no `session_id` / `runtime_context_id`), then merged into one
chronological `timeline[]`.

## What the CLI cannot reach (and why)

The Builder Conversations UI renders its full chronicle from:

```
GET /api/v1/bff/conversations/acts?session_id=<uuid>
```

With an api-key-exchanged token this request **hangs** rather than returning.
The token's `account_id` claim is empty, and the endpoint appears to require a
logged-in **user** token (the same identity the Builder UI uses). Because that
endpoint is the only source for the formatted chronicle, the following layers
are **not** available to the CLI:

- the formatted `thoughts_footnote` reasoning,
- `analyze_conversation` acts,
- the end-of-session report and its semaphore/quality analysis,
- recording URLs.

The CLI documents this limitation inline (in `--full` console output and in the
README / USAGE guide) and falls back to the richest api-key-reachable view
described above.

## The ask

To let the CLI produce the full chronicle without a browser login, one of:

1. **Honor `session_id` on an api-key-reachable endpoint.** Expose the formatted
   chronicle (or its act stream) through an endpoint that accepts an
   api-key-exchanged token - e.g. allow `bff/conversations/acts?session_id=` for
   tokens whose `account_id` is resolvable from the api key, or provide a
   `designer`-scoped equivalent.
2. **Populate `account_id` in the api-key token claims.** If `acts` only needs a
   non-empty `account_id`, exchanging the api key into a token that carries the
   account would unblock the existing endpoint as-is.

Either path removes the need for a logged-in user token and lets
`newo session <uuid> --full` include the thoughts/analyze/report/recording
layers the UI shows.

## References

- Command: `src/cli/commands/session.ts`, `src/cli/commands/conversations.ts`
- Assembly: `pullConversationBySession` / `pullSessionFull` in
  `src/sync/conversations.ts`
- API wrappers: `listUserPersonas`, `getChatHistory`, `getLogs` in `src/api.ts`
