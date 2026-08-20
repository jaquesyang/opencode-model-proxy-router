# model-proxy-router

Opencode plugin: route models to different proxies via `fetch` wrapping + hot-reload.

## Config

`~/.config/opencode/model-proxy-router.json`:

```json
{
  "proxies": { "socks": "socks5://user:pass@host:port", "http": "http://user:pass@host:port" },
  "default": "direct",
  "routes": {
    "opencode-go/muse-spark-1.2-contributor": "socks",
    "opencode/muse-spark-1.2-contributor-free": "http",
    "opencode-go/*": "socks"
  }
}
```

See `model-proxy-router.json.example`.

## Test

```bash
npm test
# or
node --test test.mjs
```
