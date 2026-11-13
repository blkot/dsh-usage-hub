# dsh-usage-hub

Aggregated subscription usage for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) composer dock: the DeepSeek API balance and the OpenCode Go allowance, side by side, in one panel.

```
[● DeepSeek ¥110.00]  [● Go 7%]
```

Click either reading for the panel: DeepSeek balance with its topped-up/granted split, the OpenCode Go rolling/weekly/monthly bars with reset times, the Console workspace name, a link to the Console usage page, and a Refresh button.

## Install

The bundle is a normal local directory plugin:

```sh
git clone https://github.com/blkot/dsh-usage-hub.git
```

then install the directory with **Plugins → Add plugin**, or point `plugin_manager` at it. Installation links the checkout into the profile, so editing the files here takes effect without reinstalling (reload the page for client changes).

## What it reads

- **DeepSeek** — `GET https://api.deepseek.com/user/balance` with the credential named by `deepseek.apiKeyEnv` (default `DEEPSEEK_API_KEY`), resolved through the harness credential store first and the process environment second. DeepSeek publishes no official per-key spend endpoint; the private platform dashboard endpoints need a signed-in web session, so the balance is what this plugin can honestly show.
- **OpenCode Go** — `GET /api/experimental/usage/limits` on a local OpenCode server. By default the plugin starts the OpenCode CLI on a free loopback port, reads the printed server password, asks once, and stops it again. Configure `opencode.baseUrl` + `opencode.password` to attach to an already-running server instead.

## Configuration

```yaml
- insert:
    - id: usage-hub
      name: 'dsh-usage-hub'
      config:
        cacheTtlMs: 300000          # snapshot cache lifetime (5 minutes)
        deepseek:
          enabled: true
          apiKeyEnv: DEEPSEEK_API_KEY
          baseUrl: 'https://api.deepseek.com'
        opencode:
          enabled: true
          cliPath: ''               # empty: auto-detect the desktop install
          baseUrl: ''               # fill with password to attach to a running server
          password: ''
          startTimeoutMs: 25000
```

`enabled: false` on a provider removes its reading from the dock; the panel still names it as turned off.

## Request frequency

| Layer | Frequency | Notes |
|---|---|---|
| Browser → plugin route | every 5 minutes | `POLL_MS` in `client.js`, plus one read at page load |
| Plugin → upstream | at most once per `cacheTtlMs` | one DeepSeek call + one OpenCode query per cache miss |
| Panel Refresh | immediately | bypasses the cache; both providers re-read |

- The client poll and the cache TTL are both five minutes, so a poll almost always finds the cache expired: upstream traffic is effectively one refresh per five minutes while a page is open.
- An in-flight read is shared, so several tabs or windows do not multiply upstream calls.
- Every OpenCode read starts a short-lived `opencode serve` (a couple of seconds) and stops it; the DeepSeek read is a single lightweight GET.

## Notes and limits

- OpenCode usage requires a Console sign-in that the OpenCode app holds. An unsigned profile answers `data: null`, and the panel reports it as not configured.
- The OpenCode reading is only as fresh as its local server: an `opencode` binary must be reachable (auto-detected from the desktop install, or set `cliPath`).
- Nothing secret is stored by this plugin: the DeepSeek key lives in the harness credential store, and the OpenCode server password is read from the process the plugin started.

## License

MIT
