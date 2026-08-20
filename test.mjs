import { test } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ModelProxyRouter from "./model-proxy-router.ts"
const { createRouter } = ModelProxyRouter

import { existsSync } from "node:fs"
const _cfg = join(import.meta.dirname, "model-proxy-router.json")
const _example = join(import.meta.dirname, "model-proxy-router.json.example")
const CONFIG = existsSync(_cfg) ? _cfg : _example

const calls = []
globalThis.fetch = async (input, init) => {
  calls.push({ input, init })
  return { ok: true }
}

const router = createRouter(CONFIG)
const { wrappedFetch, agents } = router
const socks = agents.get("socks")
const http = agents.get("http")

assert.ok(typeof socks?.url === "string", "socks has url")
assert.ok(typeof http?.url === "string", "http has url")

async function fetchBody(body) {
  calls.length = 0
  await wrappedFetch("https://opencode.ai/v1/chat/completions", { body })
  return calls[0]?.init
}

async function expectProxy(name, model, agent) {
  const init = await fetchBody(JSON.stringify({ model }))
  // Bun fetch uses `proxy` option (url string).
  assert.equal(init?.proxy, agent.url, name)
}

test("exact: full id -> socks", async () =>
  expectProxy("exact-full", "opencode-go/muse-spark-1.2-contributor", socks))

test("exact: bare id -> socks", async () =>
  expectProxy("exact-bare", "muse-spark-1.2-contributor", socks))

test("exact: -free full -> http", async () =>
  expectProxy("free-full", "opencode/muse-spark-1.2-contributor-free", http))

test("exact: -free bare -> http", async () =>
  expectProxy("free-bare", "muse-spark-1.2-contributor-free", http))

test("wildcard: opencode-go/* full id -> socks", async () =>
  expectProxy("wildcard-full", "opencode-go/kimi-k2.6", socks))

test("unmatched model -> direct", async () => {
  const init = await fetchBody(JSON.stringify({ model: "opencode/hy3-free" }))
  assert.equal(init?.proxy, undefined, "unmatched should be direct")
})

test("model not in body -> direct", async () => {
  const init = await fetchBody(JSON.stringify({ foo: "bar" }))
  assert.equal(init?.proxy, undefined)
})

test("non-json body -> direct", async () => {
  const init = await fetchBody("not-json")
  assert.equal(init?.proxy, undefined)
})

test("no body -> passes through untouched", async () => {
  calls.length = 0
  await wrappedFetch("https://opencode.ai/telemetry", undefined)
  assert.equal(calls[0]?.init, undefined)
})

test("GET-like no init -> forwards one call", async () => {
  calls.length = 0
  await wrappedFetch("https://opencode.ai/health")
  assert.equal(calls.length, 1)
})

test("default: unmatched uses catch-all proxy", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpr-"))
  const path = join(dir, "config.json")
  writeFileSync(
    path,
    JSON.stringify({
      proxies: { socks: "socks5://127.0.0.1:6370", http: "http://127.0.0.1:6370" },
      default: "http",
      routes: {},
    })
  )
  const r = createRouter(path)
  assert.equal(r.pick("anything/unmatched"), r.agents.get("http"))
})

test("reload picks up new routes", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpr-"))
  const path = join(dir, "config.json")
  const base = { proxies: { socks: "socks5://127.0.0.1:6370" }, default: "direct" }
  writeFileSync(path, JSON.stringify({ ...base, routes: { "a/b": "socks" } }))
  const r = createRouter(path)
  assert.equal(r.pick("a/b"), r.agents.get("socks"))

  writeFileSync(path, JSON.stringify({ ...base, routes: { "c/d": "socks" } }))
  r.reload()
  assert.equal(r.pick("a/b"), null)
  assert.equal(r.pick("c/d"), r.agents.get("socks"))
})