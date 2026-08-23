import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const HOME = process.env.HOME || "/home/user"
const CONFIG = path.join(HOME, ".config/opencode")
const STATE_PATH = path.join(CONFIG, ".expert_monitor.json")
const DRIFT_LOG = path.join(CONFIG, "expert_drift.log")

// Порог из EXPERT_PROTOCOL.md: steps_since_expert >= 2 -> STOP + вызов Expert
const THRESHOLD = 2
// TTL авто-разблокировки (вердикт Expert 2026-08-21 вечер: 60с — достаточно,
// судья отвечает за 7-15с; 120с создавало «вечность» для пользователя).
const EXPERT_BLOCK_TTL_MS = 60000

// Read-only whitelist (вердикт Expert 2026-08-21): диагностика НИКОГДА
// не блокируется барьером — только мутирующие операции.
const READONLY_CMDS = new Set([
  "cat", "ls", "grep", "rg", "head", "tail", "wc", "stat", "file", "find",
  "pwd", "ps", "id", "uname", "uptime", "date", "which", "printenv", "du",
  "df", "free", "journalctl", "echo", "true", "test", "basename", "dirname",
  "realpath", "diff",
])

type State = {
  steps_since_expert: number
  mutations_since_verdict: number
  last_expert_ts: number | null
  // Фаза 6.5 (решение пользователя 2026-08-21): механический бэкстоп критика.
  mutations_since_critic: number
  last_critic_ts: number | null
  last_tool: string
  blockedSince: number | null
  updated_at: number
}

const load = (): State => {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as State
    if (parsed.blockedSince === undefined) parsed.blockedSince = null
    if (parsed.mutations_since_critic === undefined) parsed.mutations_since_critic = 0
    if (parsed.last_critic_ts === undefined) parsed.last_critic_ts = null
    if (!bootResetDone) {
      bootResetDone = true
      parsed.steps_since_expert = 0
      parsed.mutations_since_verdict = 0
      parsed.mutations_since_critic = 0
      parsed.blockedSince = null
      parsed.updated_at = Date.now()
      writeFileSync(STATE_PATH, JSON.stringify(parsed, null, 2), "utf8")
    }
    return parsed
  } catch {
    return {
      steps_since_expert: 0,
      mutations_since_verdict: 0,
      last_expert_ts: null,
      mutations_since_critic: 0,
      last_critic_ts: null,
      last_tool: "",
      blockedSince: null,
      updated_at: Date.now(),
    }
  }
}

const save = (s: State) => {
  s.updated_at = Date.now()
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), "utf8")
}

const isExpertCall = (cmd: string): boolean =>
  /bin\/expert\b/.test(cmd) || /(^|\s|;)expert\s+["']/.test(cmd)

const isMutation = (tool: string): boolean =>
  tool === "write" || tool === "edit" || tool === "multiedit"

// sed только в режиме печати (вердикт Expert, вариант D + правки Critic):
// обязателен -n; запрещены -i/--in-place/--posix; тело скрипта разбирается
// мини-парсером: после снятия адреса ($, N, N,M, /regex/) допускаются ТОЛЬКО
// команды печати p/P/d/D/n/N/=/l/q. Команды s///, y///, w/W/e/r/b/t/: — отказ
// (закрывает обходы вида 1w /tmp/x и s/.*/cmd/ge, пойманные Critic).
export const isSafeSed = (seg: string): boolean => {
  if (!/^sed(\s|$)/.test(seg)) return false
  if (/(^|\s)-[A-Za-z]*i|--in-place|--posix/.test(seg)) return false
  if (!/(^|\s)-[A-Za-z]*n/.test(seg)) return false
  const m = seg
    .replace(/^sed\s+/, "")
    .match(/^(?:-[A-Za-z]+(?:=\S+)?\s+|-e\s+)*["']([^"']*)["'](?:\s+\S+)*$/)
  if (!m) return false
  return m[1]
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .every((part) => {
      const rest = part
        .replace(/^(\$\d*|\d+\s*(?:,\s*(?:\$\d*|\d+))?)/, "")
        .replace(/^\/(?:[^/\\]|\\.)*\/[A-Za-z]*/, "")
        .trim()
      return rest === "" || /^[pPdDnN=lq]$/.test(rest)
    })
}

// Сегментация конвейера С УЧЁТОМ кавычек (Critic: '1p;5p' не должен рваться
// по ; внутри кавычек; && || ; | учитываются только вне '...' и "...").
const splitSegments = (cmd: string): string[] => {
  const out: string[] = []
  let cur = ""
  let q: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      cur += c
      if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      cur += c
      continue
    }
    const two = cmd.slice(i, i + 2)
    if (two === "&&" || two === "||") {
      out.push(cur)
      cur = ""
      i++
      continue
    }
    if (c === ";" || c === "|") {
      out.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

// bash read-only <=> каждый сегмент конвейера начинается с whitelist-команды,
// нет редиректов/tee/подстановок (консервативно: сомнение = мутация).
export const isReadOnlyBash = (cmd: string): boolean => {
  if (/[><]|`|\$\(|\btee\b/.test(cmd)) return false
  return splitSegments(cmd)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)
    .every((seg) => {
      const first = seg.split(/\s+/)[0]
      if (first === "systemctl")
        return /^(--user\s+)?(status|show|is-active|list-units|list-timers)\b/.test(
          seg.replace(/^systemctl\s+/, ""),
        )
      if (first === "sed") return isSafeSed(seg)
      return READONLY_CMDS.has(first)
    })
}

// Новый процесс opencode = новая сессия: счётчики не наследуются
// (дефект #3 из вердикта Expert 2026-08-21).
let bootResetDone = false

export default (async () => {
  // Активный барьер: при дрейфе (>=THRESHOLD шагов без Expert) следующий
  // рабочий инструмент ОТКЛОНЯЕТСЯ с требованием вызвать Expert.
  // Аварийный выход: маркер EXPERT-OVERRIDE в команде (пишется в drift log).
  const barrier = ({ tool, cmdOverride }: { tool: string; cmdOverride?: string }) => {
    if (tool !== "bash" && !isMutation(tool)) return
    const cmd = cmdOverride ?? ""
    // Read-only диагностика НЕ блокируется барьером вообще (вердикт Expert,
    // вариант D): whitelist-команды и sed -n без записи.
    if (tool === "bash" && isReadOnlyBash(cmd)) return
    if (isExpertCall(cmd)) return
    if (cmd.includes("EXPERT-OVERRIDE")) {
      appendFileSync(
        DRIFT_LOG,
        `${new Date().toISOString()} OVERRIDE used (expert unreachable?) :: ${cmd.slice(0, 120).replace(/\n/g, " ")}\n`,
        "utf8",
      )
      return
    }
    const s = load()
    // TTL авто-разблокировки: если блокировка висит дольше EXPERT_BLOCK_TTL_MS —
    // снять принудительно (защита от вечного дедлока, вердикт Expert 2026-08-21).
    if (s.blockedSince !== null) {
      const elapsed = Date.now() - s.blockedSince
      if (elapsed >= EXPERT_BLOCK_TTL_MS) {
        s.steps_since_expert = 0
        s.mutations_since_verdict = 0
        s.blockedSince = null
        save(s)
        appendFileSync(
          DRIFT_LOG,
          `${new Date().toISOString()} TTL auto-release after ${elapsed}ms\n`,
          "utf8",
        )
      }
    }
    if (s.steps_since_expert >= THRESHOLD) {
      if (s.blockedSince === null) {
        s.blockedSince = Date.now()
        save(s)
      }
      appendFileSync(
        DRIFT_LOG,
        `${new Date().toISOString()} BLOCK ${tool} steps=${s.steps_since_expert} :: ${cmd.slice(0, 120).replace(/\n/g, " ")}\n`,
        "utf8",
      )
      throw new Error(
        `[EXPERT KICK] steps_since_expert=${s.steps_since_expert} (порог ${THRESHOLD}). ` +
          `НЕ добавляй EXPERT-OVERRIDE и не жди TTL — СРАЗУ вызови судью: ` +
          `task(subagent_type="expert", prompt="<верди́кт-вопрос + факты>"). ` +
          `Это сбросит счётчик и разблокирует работу. ` +
          `TTL-разблокировка через ${Math.max(0, Math.ceil((EXPERT_BLOCK_TTL_MS - (Date.now() - (s.blockedSince ?? Date.now()))) / 1000))}с — только как аварийный запасной путь.`,
      )
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      // BUGFIX (аудит 2026-08-21): по API @opencode-ai/plugin args приходят в
      // output.args, а не во входе. Раньше cmd всегда был "" -> монитор не видел
      // ни вызовы expert, ни маркер EXPERT-OVERRIDE -> вечный дедлок.
      const args = output?.args ?? (input as { args?: unknown }).args
      const raw =
        input.tool === "bash"
          ? String((args as { command?: string })?.command ?? "")
          : JSON.stringify(args ?? {})
      barrier({ tool: input.tool, cmdOverride: raw })
    },
    "tool.execute.after": async ({ tool, args }) => {
      const s = load()

      if (tool === "bash") {
        const cmd = String((args as { command?: string })?.command ?? "")
        if (isExpertCall(cmd)) {
          // Вызов Expert состоялся -> счётчики сброшены, факт в лог
          s.steps_since_expert = 0
          s.mutations_since_verdict = 0
          s.last_expert_ts = Date.now()
          s.last_tool = "bash(expert)"
          save(s)
          appendFileSync(
            DRIFT_LOG,
            `${new Date().toISOString()} OK expert_call -> counters reset\n`,
            "utf8",
          )
          return
        }
      }

      // Новый канал Expert: task-субагент `expert` (та же модель что в чате,
      // с 2026-08-21). Вызов состоялся -> счётчики сброшены.
      if (tool === "task") {
        const sub = String((args as { subagent_type?: string })?.subagent_type ?? "")
        if (/^expert$/i.test(sub)) {
          s.steps_since_expert = 0
          s.mutations_since_verdict = 0
          s.last_expert_ts = Date.now()
          s.last_tool = "task(expert)"
          save(s)
          appendFileSync(
            DRIFT_LOG,
            `${new Date().toISOString()} OK expert_call(task) -> counters reset\n`,
            "utf8",
          )
          return
        }
        // Фаза 6.5: вызов критика фиксируется механически (бэкстоп HARD STOP).
        // Счётчик мутаций без критика обнуляется, steps_since_expert НЕ трогаем —
        // критик не судья корректности.
        if (/^critic$/i.test(sub)) {
          s.mutations_since_critic = 0
          s.last_critic_ts = Date.now()
          s.last_tool = "task(critic)"
          save(s)
          appendFileSync(
            DRIFT_LOG,
            `${new Date().toISOString()} OK critic_call -> mutations_since_critic reset\n`,
            "utf8",
          )
          return
        }
      }

      // Учитываем рабочие инструменты как "шаг без Expert".
      // Read-only bash (whitelist + sed -n без записи) шагом НЕ считается
      // (вердикт Expert, вариант D).
      const afterCmd = String((args as { command?: string })?.command ?? "")
      if (tool === "bash" && isReadOnlyBash(afterCmd)) {
        return
      }
      if (tool === "bash" || isMutation(tool)) {
        s.steps_since_expert += 1
        if (isMutation(tool)) {
          s.mutations_since_verdict += 1
          s.mutations_since_critic += 1
        }
        s.last_tool = tool
        if (s.steps_since_expert >= THRESHOLD) {
          const brief =
            tool === "bash"
              ? String((args as { command?: string })?.command ?? "").slice(0, 120)
              : String((args as { filePath?: string })?.filePath ?? tool).slice(0, 120)
          appendFileSync(
            DRIFT_LOG,
            `${new Date().toISOString()} DRIFT steps=${s.steps_since_expert} mut=${s.mutations_since_verdict} tool=${tool} :: ${brief.replace(/\n/g, " ")}\n`,
            "utf8",
          )
        }
        save(s)
      }
    },
  }
}) satisfies Plugin
