# Subproject: opencode stack

Subagents and plugins for the [opencode](https://opencode.ai) CLI.

## Contents

| Path | Purpose |
|---|---|
| `agent/expert.md` | Expert judge subagent: clean context, zero memory, strict auditor prompt |
| `agent/critic.md` | Harsh QA-critic subagent: read-only, auto-invoked after mutating tasks |
| `plugin/expert_monitor.ts` | Drift monitor: counters, read-only whitelist, block + TTL release |
| `plugin/expert_statusbar.tsx` | Statusbar: expert/critic state |
| `plugin/memory.ts` | Session memory: session log + mirror into MEMORY.md |
| `plugin/statusbar.tsx` | Base statusbar |
| `opencode.json.example` | Example registration of plugins/instructions/provider |

## Install

```bash
cp agent/*.md ~/.config/opencode/agent/
cp plugin/* ~/.config/opencode/plugin/
cp opencode.json.example ~/.config/opencode/opencode.json  # merge manually
# restart opencode — agents/plugins are picked up at startup
```

Requires the protocol doc: [`../docs/EXPERT_PROTOCOL.md`](../docs/EXPERT_PROTOCOL.md)
(register it in `instructions`).
