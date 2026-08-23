import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"

const HOME = process.env.HOME || "/home/user"
const CONFIG = path.join(HOME, ".config/opencode")
const LOG_PATH = path.join(CONFIG, "sessions.log.md")
const MEMORY_PATH = path.join(CONFIG, "MEMORY.md")
const MAX_MEMORY_ENTRIES = 12

const clean = (s: string) => s.replace(/\s+/g, " ").trim()
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function textOf(message: Message): string {
  const parts = (message as unknown as { parts?: Array<Part> }).parts ?? []
  return parts
    .filter((p) => p.type === "text" && typeof (p as { text?: string }).text === "string")
    .map((p) => (p as { text: string }).text)
    .join(" ")
}

function isWriteEditTool(tool: string): boolean {
  return tool === "write" || tool === "edit"
}

export default (async ({ client, directory }) => {
  const files = new Map<string, Set<string>>()
  const dirty = new Map<string, boolean>()

  const markDirty = (sessionID: string) => {
    dirty.set(sessionID, true)
  }

  const entryFor = (
    sessionID: string,
    req: string,
    last: string,
    fileList: string[],
    dir: string,
  ): string => {
    const date = new Date().toISOString().slice(0, 10)
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    return [
      `<!-- session-${sessionID} -->`,
      `### ${date} ${time} · ${path.basename(dir) || "."} · sess ${sessionID.slice(0, 8)}`,
      `- Запрос: ${short(clean(req), 160) || "—"}`,
      `- Файлы: ${fileList.length ? fileList.map((f) => `\`${f}\``).join(", ") : "—"}`,
      `- Итог: ${short(clean(last), 260) || "—"}`,
      "",
    ].join("\n")
  }

  const updateLog = async (sessionID: string, entry: string) => {
    let content = ""
    try {
      content = await readFile(LOG_PATH, "utf8")
    } catch {
      content = "# Журнал сессий (автоплагин)\n\n"
    }
    const marker = `<!-- session-${sessionID} -->`
    const start = content.indexOf(marker)
    if (start >= 0) {
      const after = content.indexOf("<!-- session-", start + marker.length)
      const end = after >= 0 ? after : content.length
      content = content.slice(0, start) + entry + content.slice(end)
    } else {
      content = content.replace(/\n*$/, "\n") + entry
    }
    await writeFile(LOG_PATH, content, "utf8")
  }

  const syncMemory = async () => {
    let log = ""
    try {
      log = await readFile(LOG_PATH, "utf8")
    } catch {
      return
    }
    const blocks: Array<string[]> = []
    let cur: string[] | null = null
    for (const ln of log.split("\n")) {
      if (ln.startsWith("<!-- session-")) {
        if (cur) blocks.push(cur)
        cur = [ln]
      } else if (cur) {
        cur.push(ln)
      }
    }
    if (cur) blocks.push(cur)
    const body = blocks
      .slice(-MAX_MEMORY_ENTRIES)
      .map((b) => b.join("\n").trimEnd())
      .join("\n")
    const section = `\n<!-- memory-plugin:start -->\n## Автолог сессий (плагин)\n${body}\n<!-- memory-plugin:end -->\n`
    let mem = ""
    try {
      mem = await readFile(MEMORY_PATH, "utf8")
    } catch {
      mem = ""
    }
    const re = /<!-- memory-plugin:start -->[\s\S]*<!-- memory-plugin:end -->/
    const next = re.test(mem)
      ? mem.replace(re, section.trim())
      : mem.replace(/\n*$/, "\n") + section.trim() + "\n"
    await writeFile(MEMORY_PATH, next, "utf8")
  }

  const finalize = async (sessionID: string) => {
    try {
      const sess = await client.session.get({ path: { id: sessionID }, throwOnError: true })
      const dir = sess.data.directory || directory || "."
      const res = await client.session.messages({
        path: { id: sessionID },
        query: { limit: 100 },
        throwOnError: true,
      })
      const msgs = res.data
        .map((m) => m.info)
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      let req = ""
      let last = ""
      for (const m of msgs) {
        const t = textOf(m)
        if (!t) continue
        if (m.role === "user" && !req) req = t
        if (m.role === "assistant") last = t
      }
      const fileList = [...(files.get(sessionID) ?? [])].slice(0, 8)
      const entry = entryFor(sessionID, req || sess.data.title, last, fileList, dir)
      await updateLog(sessionID, entry)
      await syncMemory()
      dirty.set(sessionID, false)
    } catch (err) {
      console.error("[memory-plugin]", (err as Error)?.message ?? err)
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        files.set(event.properties.info.id, new Set())
        return
      }
      if (event.type === "session.idle") {
        const id = event.properties.sessionID
        if (id && dirty.get(id)) await finalize(id)
      }
    },
    "chat.message": async (input) => {
      if (input.sessionID) markDirty(input.sessionID)
    },
    "tool.execute.after": async ({ sessionID, tool, args }) => {
      if (!sessionID) return
      if (isWriteEditTool(tool)) {
        const fp = (args as { filePath?: string })?.filePath
        if (fp) {
          if (!files.has(sessionID)) files.set(sessionID, new Set())
          files.get(sessionID)!.add(fp.replace(HOME, "~"))
        }
      }
      markDirty(sessionID)
    },
  }
}) satisfies Plugin
