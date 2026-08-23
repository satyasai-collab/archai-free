import { readFileSync } from "node:fs"
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const HOME = process.env.HOME || "/home/user"
const STATE_PATH = `${HOME}/.config/opencode/.expert_monitor.json`

type State = {
  steps_since_expert: number
  mutations_since_verdict: number
  last_expert_ts: number | null
  mutations_since_critic: number
  last_critic_ts: number | null
  updated_at: number
}

function readState(): State | null {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State
  } catch {
    return null
  }
}

const tui: TuiPlugin = async (api) => {
  const signal = api.lifecycle?.signal
  api.slots.register({
    order: 51,
    slots: {
      sidebar_content(_ctx: unknown, _props: { session_id: string }) {
        const [st, setSt] = createSignal<State | null>(readState())
        const timer = setInterval(() => setSt(readState()), 2000)
        if (signal) {
          signal.addEventListener("abort", () => clearInterval(timer), { once: true })
        }
        onCleanup(() => clearInterval(timer))

        const s = st()
        const steps = s?.steps_since_expert ?? 0
        const mut = s?.mutations_since_verdict ?? 0
        const drift = steps >= 2
        const last = s?.last_expert_ts ? new Date(s.last_expert_ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"
        const lastCritic = s?.last_critic_ts ? new Date(s.last_critic_ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"
        const mutCritic = s?.mutations_since_critic ?? 0
        const criticWarn = mutCritic > 0 ? "⚠ ЖДИ КРИТИКА" : "✓"
        const mark = drift ? "⚠ ДРЕЙФ" : "✓"
        return (
          <box title="Expert Monitor">
            <text>
              {`Шагов без Expert: ${steps} ${mark}`}
            </text>
            <text>{`Мутаций без вердикта: ${mut}`}</text>
            <text>{`Мутаций без критика: ${mutCritic} ${criticWarn}`}</text>
            <text>{`Последний Expert: ${last}`}</text>
            <text>{`Последний Critic: ${lastCritic}`}</text>
            <text>{drift ? "СТОП: вызови Expert!" : "Протокол соблюдается"}</text>
          </box>
        )
      },
    },
  })
}

export default { id: "expert-monitor-statusbar", tui }
