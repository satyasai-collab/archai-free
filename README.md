# ArchAI Free — multi-role agent architecture on free models

Multi-role AI agent scheme where cheap/fast **free-tier** models are split into
three roles instead of one over-loaded generalist:

```
                 ┌─────────────────┐
   user ───────► │    Executor     │  fast free model (chat)
                 │  does the work  │  tools: bash/edit/read/write
                 └───┬─────────┬───┘
       task(expert)  │         │  task(critic)
                     ▼         ▼
          ┌────────────┐   ┌────────────┐
          │   Expert   │   │   Critic   │
          │  judge,    │   │ harsh QA,  │
          │ zero memory│   │ read-only  │
          └────────────┘   └────────────┘
```

- **Executor** — executes, never self-verifies in multi-step tasks.
- **Expert (judge)** — same-class model with clean context and a strict auditor
  prompt; decomposes, verifies every step, gives final verdict.
- **Critic** — automatic hard-stop QA after any mutating task; rejects
  half-done work.

Two independent stacks are included:

| Stack | Path | What's inside |
|---|---|---|
| opencode | [`opencode/`](opencode/) | subagents (`expert`, `critic`), plugins: drift monitor, statusbars, memory |
| Hermes | [`hermes/`](hermes/) | SOUL.md executor protocol, plugins `critic_hy3`, `role_monitor` |

## Docs

- [`docs/EXPERT_PROTOCOL.md`](docs/EXPERT_PROTOCOL.md) — canonical protocol:
  phases, anti-drift counters, hard stops, output contract.
- [`docs/HERMES_MULTI_ROLE_PROTOCOL.md`](docs/HERMES_MULTI_ROLE_PROTOCOL.md) —
  the same role scheme adapted for the Hermes agent.
- [`docs/AUDIT_2026-08-23.md`](docs/AUDIT_2026-08-23.md) — honest list of known
  architectural weaknesses (read-only audit, nothing fixed yet).

## Install (opencode stack)

1. Copy `opencode/agent/*` to `~/.config/opencode/agent/`.
2. Copy `opencode/plugin/*` to `~/.config/opencode/plugin/`.
3. Register plugins and instructions in `opencode.json`
   (see `opencode/opencode.json.example`).
4. Restart opencode — agents and monitor are picked up at startup.

## Install (Hermes stack)

1. Put `hermes/SOUL.md` into the profile directory (`~/.hermes/SOUL.md`).
2. Copy `hermes/plugins/<name>` into `~/.hermes/plugins/`.
3. Enable: `hermes plugins enable critic_hy3 role_monitor`.

## Known limitations

See [`docs/AUDIT_2026-08-23.md`](docs/AUDIT_2026-08-23.md). Highlights:
single judge channel = SPOF, free-tier flakiness, enforcement is mostly
prompt-based. The scheme trades reliability for cost discipline.

## License

MIT — see [LICENSE](LICENSE).
