# Subproject: Hermes stack

Multi-role scheme for the Hermes agent (Executor role via SOUL.md,
Expert via delegation, Critic via plugin tool).

## Contents

| Path | Purpose |
|---|---|
| `SOUL.md` | Executor identity + routing rules (sequential judge calls, no parallel to local API) |
| `config.example.yaml` | Non-secret config excerpt: model, delegation, plugins |
| `plugins/critic_hy3/` | `critic` tool → harsh QA model over free-tier endpoint |
| `plugins/role_monitor/` | post_tool_call drift counters + `expert_drift.log` |

## Install

```bash
cp SOUL.md ~/.hermes/SOUL.md
cp -r plugins/critic_hy3 plugins/role_monitor ~/.hermes/plugins/
hermes plugins enable critic_hy3 role_monitor
```

Protocol doc: [`../docs/HERMES_MULTI_ROLE_PROTOCOL.md`](../docs/HERMES_MULTI_ROLE_PROTOCOL.md).
