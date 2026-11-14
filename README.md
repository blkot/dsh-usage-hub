# dsh-usage-hub

Aggregated subscription usage for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) composer dock: the DeepSeek API balance and the OpenCode Go allowance, side by side, in one panel.

```
[● DeepSeek ¥110.00]  [● Go 7%]
```

Click either reading for the panel: DeepSeek balance with its topped-up/granted split, the OpenCode Go rolling/weekly/monthly bars with reset times, and a Refresh button.

## Install

```sh
git clone https://github.com/blkot/dsh-usage-hub.git
```

then install the directory with **Plugins → Add plugin**, or point `plugin_manager` at it. Installation links the checkout into the profile, so editing the files here takes effect without reinstalling (reload the page for client changes).

## What it reads

- **DeepSeek** — `GET https://api.deepseek.com/user/balance` with the credential named by `deepseek.apiKeyEnv` (default `DEEPSEEK_API_KEY`), resolved through the harness credential store first and the process environment second. DeepSeek publishes no official per-key spend endpoint; the private platform dashboard endpoints need a signed-in web session, so the balance is what this plugin can honestly show.
- **OpenCode Go** — two possible sources, chosen by `opencode.mode`:
  - **`api` (the `auto` default)** — `GET https://opencode.ai/zen/go/v1/usage` with the Go API key named by `opencode.apiKeyEnv` (default `OPENCODE_GO_API_KEY`), which is the same key the `opencode-go` model provider uses. Nothing else needs to be installed, so this works on any machine that can already talk to the provider. It returns the rolling/weekly/monthly percentages and their reset instants.
  - **`server`** — `GET /api/experimental/usage/limits` on a local OpenCode server: the plugin attaches to a server you configure (`opencode.baseUrl` + `opencode.password`), or starts the CLI on a free loopback port, reads its printed password, asks once, and stops it again. This also reports the Console workspace name, the usage-page link and Console budgets.

  `auto` uses the API key when it resolves and falls back to a local server otherwise; `api` never starts a process; `server` never uses the key.

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
          mode: auto                # auto | api | server
          apiKeyEnv: OPENCODE_GO_API_KEY
          apiBaseUrl: 'https://opencode.ai/zen/go/v1'
          cliPath: ''               # server mode: empty: auto-detect the desktop install
          baseUrl: ''               # server mode: fill with password to attach to a running server
          password: ''
          startTimeoutMs: 25000
```

`enabled: false` on a provider removes its reading from the dock; the panel still names it as turned off.

## Request frequency

| Layer | Frequency | Notes |
|---|---|---|
| Browser → plugin route | every 5 minutes | `POLL_MS` in `client.js`, plus one read at page load |
| Plugin → upstream | at most once per `cacheTtlMs` | one DeepSeek call + one OpenCode call per cache miss |
| Panel Refresh | immediately | bypasses the cache; both providers re-read |

- The client poll and the cache TTL are both five minutes, so a poll almost always finds the cache expired: upstream traffic is effectively one refresh per five minutes while a page is open.
- An in-flight read is shared, so several tabs or windows do not multiply upstream calls.
- In `server` mode every OpenCode read starts a short-lived `opencode serve` (a couple of seconds) and stops it; in `api` mode it is a single lightweight GET.

## Troubleshooting

- **OpenCode reads "no OpenCode credential was found"** — the `opencode-go` API key is not in the credential store and no local CLI was found. Configure the provider key in **Settings → Models** (it is stored as `OPENCODE_GO_API_KEY`), then refresh. The API-key path needs no OpenCode app at all.
- **OpenCode reads "Not configured"** — the key resolved, but the gateway answered that the account has no Go allowance, or the usage payload carried no window; the panel shows the raw diagnostic under the hint.
- **DeepSeek reads "Not configured"** — the credential named by `deepseek.apiKeyEnv` is missing.

## Notes and limits

- The OpenCode reading is only as fresh as its source: the gateway's own numbers in `api` mode, or the local server's Console view in `server` mode.
- Nothing secret is stored by this plugin: both keys live in the harness credential store, and a server password is read from the process the plugin started.

## License

MIT
