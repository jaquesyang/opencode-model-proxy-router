import { watch } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import { createRouter, DEFAULT_CONFIG_PATH, DEBUG } from "./router"

type Any = any

export default (async (_input: Any, options: Any) => {
  const cfgPath: string = options?.configPath ?? DEFAULT_CONFIG_PATH
  let router = createRouter(cfgPath)
  ;(globalThis as Any).fetch = router.wrappedFetch

  const rememberBaseUrls = async (input: Any) => {
    const providerID = input?.model?.providerID
    const baseURL = input?.model?.api?.url
    if (typeof providerID === "string" && typeof baseURL === "string") {
      router.setBaseUrl(providerID, baseURL)
      if (DEBUG) {
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
}) satisfies Plugin
