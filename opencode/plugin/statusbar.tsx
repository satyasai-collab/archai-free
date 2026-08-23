import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs"
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

type Proc = {
  pid: number
  name: string
  file: string
  url: string
  bytes: number
  prev: number
  speed: number
  total: number
}

const MIN_BYTES = 10 * 1024
const INTERVAL_MS = 2000
const HEAD_TTL_MS = 60000

function cmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ")
  } catch {
    return ""
  }
}

function procName(cmd: string): string {
  const first = cmd.split(" ")[0]?.split("/").pop()
  return first || "?"
}

function extractTarget(cmd: string): string | null {
  // curl -o FILE / curl --output FILE
  const m = cmd.match(/(?:-o|--output|--output-dir)\s+(\S+)/)
  if (m) return m[1]
  // wget -O FILE
  const w = cmd.match(/-O\s+(\S+)/)
  if (w) return w[1]
  // aria2c -d DIR -o FILE  → try last non-flag arg as path
  const flags = cmd.split(" ").filter((s) => s && !s.startsWith("-"))
  const last = flags[flags.length - 1]
  return last && /\.(zip|tar|gz|bz2|xz|iso|bin|img|tgz|7z|pdf|mp4|mkv)$/i.test(last) ? last : null
}

function extractUrl(cmd: string): string {
  const t = cmd.match(/(https?:\/\/\S+)/i)
  return t ? t[1].replace(/[),;'"]+$/, "") : ""
}

function fileSize(pid: number, file: string): number {
  if (file && file.includes("/")) {
    try {
      return statSync(file).size ?? 0
    } catch {
      /* ignore */
    }
  }
  // fallback: largest file owned by current user in /proc/<pid>/fd
  let best = 0
  try {
    const base = `/proc/${pid}/fd`
    for (const fd of readdirSync(base)) {
      let link = ""
      try {
        link = readlinkSync(`${base}/${fd}`)
      } catch {
        /* ignore */
      }
      if (link.startsWith("/") && /\/(home|tmp|var|root)\//.test(link)) {
        try {
          const s = statSync(link).size ?? 0
          if (s > best) best = s
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return best
}

function detect(): Proc[] {
  const out: Proc[] = []
  let dir: string[] = []
  try {
    dir = readdirSync("/proc")
  } catch {
    return out
  }
  for (const entry of dir) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    const cmd = cmdline(pid)
    if (!cmd) continue
    const name = procName(cmd)
    if (!/^(curl|wget|aria2c|yt-dlp|axy|rsync|scp|git|ffmpeg)$/i.test(name)) continue
    const file = extractTarget(cmd) || ""
    const url = extractUrl(cmd)
    const bytes = fileSize(pid, file)
    if (bytes < MIN_BYTES) continue
    out.push({ pid, name, file, url, bytes, prev: bytes, speed: 0, total: 0 })
  }
  return out
}

const tui: TuiPlugin = async (api) => {
  const signal = api.lifecycle?.signal
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx: unknown, _props: { session_id: string }) {
        const [rows, setRows] = createSignal<Proc[]>([])
        let prev = new Map<number, number>()
        const totals = new Map<string, { size: number; at: number }>()

        async function fetchTotals(list: Proc[]) {
          for (const p of list) {
            if (!p.url) continue
            const cached = totals.get(p.url)
            if (cached && Date.now() - cached.at < HEAD_TTL_MS) {
              p.total = cached.size
              continue
            }
            try {
              const res = await fetch(p.url, { method: "HEAD", redirect: "follow" })
              const len = Number(res.headers.get("content-length") || 0)
              if (len > 0) {
                totals.set(p.url, { size: len, at: Date.now() })
                p.total = len
              }
            } catch {
              /* network errors ignored */
            }
          }
          setRows(list)
        }

        const timer = setInterval(async () => {
          const now = detect()
          for (const p of now) {
            const last = prev.get(p.pid)
            p.speed = last ? Math.max(0, (p.bytes - last) / (INTERVAL_MS / 1000)) : 0
            prev.set(p.pid, p.bytes)
          }
          prev = new Map([...prev].filter(([pid]) => now.some((p) => p.pid === pid)))
          setRows(now)
          await fetchTotals(now)
        }, INTERVAL_MS)
        if (signal) {
          signal.addEventListener("abort", () => clearInterval(timer), { once: true })
        }
        onCleanup(() => clearInterval(timer))

        return (
          <box title="Процессы">
            <text>{rows().length === 0 ? "Нет активных процессов" : ""}</text>
            {rows().map((p) => (
              <text>{line(p)}</text>
            ))}
          </box>
        )
      },
    },
  })
}

function fmtSpeed(speed: number): string {
  if (speed >= 1024 * 1024) return `${(speed / 1024 / 1024).toFixed(1)} МБ/с`
  if (speed >= 1024) return `${Math.round(speed / 1024)} КБ/с`
  return `${Math.round(speed)} Б/с`
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} ГБ`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`
  return `${n} Б`
}

const BAR_W = 10
function pctBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = Math.round((clamped / 100) * BAR_W)
  // blocks: 4 eighths for a smooth tail, rest full
  let s = ""
  for (let i = 0; i < BAR_W; i++) {
    s += i < filled ? "█" : "░"
  }
  return s
}

function line(p: Proc): string {
  const base = `${p.name} ${p.pid} ${fmtSpeed(p.speed)}`
  if (p.total > 0 && p.bytes <= p.total) {
    const pct = Math.min(100, Math.round((p.bytes / p.total) * 100))
    return `${base} · ${pct}% ${pctBar(pct)} ${fmtSize(p.bytes)}/${fmtSize(p.total)}`
  }
  if (p.bytes > 0) return `${base} · ${fmtSize(p.bytes)}`
  return base
}

export default { id: "proc-statusbar", tui }