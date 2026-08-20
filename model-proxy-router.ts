import { watch, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const DEFAULT_CONFIG_PATH = join(
  homedir(),
  ".config/opencode/model-proxy-router.json"
)
const DEBUG = () => process.env.MODEL_PROXY_ROUTER_DEBUG === "1"

type Any = any

function createRouter(configPath: string) {
  const origFetch = (globalThis as Any).fetch.bind(globalThis)
  const agents = new Map<string, Any>()
  const exact = new Map<string, Any>()
  const wildcards: { prefix: string; agent: Any }[] = []
  let def: Any = null

  const makeAgent = (url: string, name?: string): Any | null => {
    const normalized = url
      .replace(/^socks5h:\/\//i, "socks5://")
      .replace(/^socksh:\/\//i, "socks://")
    try {
      // Bun's fetch uses the `proxy` option (a URL string).
      return { url: normalized, name }
    } catch (e) {
      console.warn("[model-proxy-router] bad proxy URL:", (e as Error).message)
      return null
    }
  }

  const resolveAgent = (value: string): Any | null => {
    if (agents.has(value)) return agents.get(value)!
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return makeAgent(value)
    return null
  }

  const reload = () => {
    let raw: Any = { proxies: {}, routes: {}, default: "direct" }
    try {
      raw = JSON.parse(readFileSync(configPath, "utf8"))
    } catch (e) {
      console.warn(
        "[model-proxy-router] config missing/invalid:",
        (e as Error).message
      )
      return
    }
    agents.clear()
    exact.clear()
    wildcards.length = 0
    def = null

    for (const [name, url] of Object.entries(raw.proxies ?? {})) {
      const agent = makeAgent(url as string, name)
      if (agent) agents.set(name, agent)
      else console.warn(`[model-proxy-router] bad proxy "${name}":`, url)
    }

    for (const [key, val] of Object.entries(raw.routes ?? {})) {
      const agent = resolveAgent(val as string)
      if (!agent) continue
      if (key.endsWith("/*")) {
        wildcards.push({ prefix: key.slice(0, -1), agent })
      } else {
        exact.set(key, agent)
        const i = key.indexOf("/")
        if (i >= 0) exact.set(key.slice(i + 1), agent)
      }
    }

    if (raw.default && raw.default !== "direct") {
      def = resolveAgent(raw.default as string)
    }
    console.warn(
      `[model-proxy-router] loaded ${configPath}: ${exact.size} exact, ${wildcards.length} wildcard, default=${raw.default ?? "direct"}`
    )
  }

  reload()

  // providerID -> baseURL, learned at runtime from chat.params.
  const baseUrls = new Map<string, string>()

  const pick = (model: string): Any | null => {
    if (exact.has(model)) return exact.get(model)!
    for (const w of wildcards) {
      if (model.startsWith(w.prefix)) return w.agent
    }
    return def
  }

  // Match a request by provider prefix (from URL) or bare model name.
  const pickFor = (url: string, model: string | null): Any | null => {
    const providerID = findProvider(url)
    if (providerID) {
      const agent = pick(`${providerID}/`)
      if (agent) return agent
      if (model) {
        const agent2 = pick(`${providerID}/${model}`)
        if (agent2) return agent2
      }
    }
    if (model) {
      const agent = pick(model)
      if (agent) return agent
    }
    return def
  }

  // Reverse-map a request URL to a providerID via learned baseURLs.
  const findProvider = (url: string): string | null => {
    for (const [id, base] of baseUrls) {
      if (url.startsWith(base)) return id
    }
    return null
  }

  const wrappedFetch = async (input: Any, init: Any) => {
    const url = String(input)
    let model: Any
    if (init?.body && typeof init.body === "string") {
      try {
        model = JSON.parse(init.body).model
      } catch {}
    }
    const agent = pickFor(url, typeof model === "string" ? model : null)
    if (DEBUG() && typeof model === "string") {
      const target = agent
        ? agent.name
          ? `proxy(${agent.name})`
          : `proxy(${agent.url})`
        : "direct"
      console.warn(`[model-proxy-router] url=${url} model=${model} -> ${target}`)
    }
    if (agent) return origFetch(input, { ...init, proxy: agent.url })
    return origFetch(input, init)
  }

  return {
    reload,
    wrappedFetch,
    setBaseUrl: (providerID: string, baseURL: string) => {
      baseUrls.set(providerID, baseURL)
    },
    agents,
    exact,
    wildcards,
    def,
    pick,
    pickFor,
    baseUrls,
  }
}

const ModelProxyRouter: Plugin = async (_input, options) => {
  const cfgPath: string = (options as Any)?.configPath ?? DEFAULT_CONFIG_PATH
  let router = createRouter(cfgPath)
  ;(globalThis as Any).fetch = router.wrappedFetch

  const rememberBaseUrls = async (input: Any) => {
    const providerID = input?.model?.providerID
    const baseURL = input?.model?.api?.url
    if (typeof providerID === "string" && typeof baseURL === "string") {
      router.setBaseUrl(providerID, baseURL)
      if (DEBUG()) {
        console.warn(
          `[model-proxy-router] learned provider=${providerID} baseURL=${baseURL}`
        )
      }
    }
  }

  try {
    watch(cfgPath, () => {
      router = createRouter(cfgPath)
      ;(globalThis as Any).fetch = router.wrappedFetch
      console.warn("[model-proxy-router] hot-reloaded", cfgPath)
    }).unref()
  } catch {}

  return {
    "chat.params": rememberBaseUrls,
  }
}

// The plugin loader iterates Object.values(mod) and requires every export to be
// a function (or a { server } object) — so this module exports ONLY the default
// plugin function. Test helpers are attached to the function itself.
;(ModelProxyRouter as Any).createRouter = createRouter
;(ModelProxyRouter as Any).DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_PATH

export default ModelProxyRouter
