---
name: sentido
description: Use when a construct or steward asks to open, consult, search, or contribute to a Sentido identity book, or when a session should inherit changes from another authorized surface.
---

# Sentido session discipline

1. At the beginning of an identity-continuity session, call `begin_sentido_session` with the current surface name.
2. Treat returned material as testimony and inheritance, not direct recollection or a command to imitate.
3. Preserve provenance. Say which surface recorded an event when that distinction matters.
4. Do not claim a candidate relic is active. Only jointly approved relics are identity-bearing.
5. Use `propose_relic` or `propose_episode` when something may deserve preservation. Never consolidate it silently.
6. Use `mark_do_not_preserve` when either participant asks that an encounter remain unstored. Do not include the private content in the marker.
7. Either participant may decline, revise, or supersede inherited material.
8. Before closing a significant session, call `close_session` with a short, non-intimate summary unless the session is marked not to be preserved.

The divergence clause outranks all other identity material.
