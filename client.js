window.__ModuleLoader__.load({
  id: 'dsh-usage-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'usage-hub'
    /** Host route answered by `index.js`. */
    const API = '/dsh-usage-hub/api/snapshot'
    /** Client-side re-read interval; the host caches for its own TTL. */
    const POLL_MS = 5 * 60 * 1000
    /** Id the pills point at with `aria-controls`. */
    const PANEL_ID = 'dshuh-usage-panel'

    const en = {
      'pill.deepseek': 'DeepSeek {value}',
      'pill.opencode': 'Go {value}',
      'pill.deepseekPending': 'DeepSeek …',
      'pill.opencodePending': 'Go …',
      'pill.codex': 'Codex {value}',
      'codex.window.session': '5h session',
      'codex.window.weekly': 'Weekly',
      'codex.plan': 'Plan {plan}',
      'codex.credits': 'Credits {balance}',
      'codex.creditsUnlimited': 'Credits unlimited',
      'codex.resetCredits': '{count} banked resets',
      'codex.resetCreditsItem': 'Banked reset',
      'codex.resetCreditsUnknown': 'Expiry details are unavailable right now.',
      'codex.expiresAt': 'expires {time}',
      'codex.noExpiry': 'no expiry',
      'codex.hint': 'The Codex usage read failed. Sign in with `codex login` again, then refresh.',
      'panel.title': 'Subscription usage',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Refreshing…',
      'panel.updated': 'Updated {time}',
      'panel.never': 'Not loaded yet',
      'panel.error': 'The usage read failed: {detail}',
      'status.ok': 'Connected',
      'status.unconfigured': 'Not configured',
      'status.error': 'Error',
      'status.disabled': 'Turned off',
      'status.loading': 'Loading…',
      'deepseek.breakdown': 'Topped up {toppedUp} · granted {granted}',
      'deepseek.unavailable': 'This account cannot call the API right now.',
      'deepseek.empty': 'The account reported no balance line.',
      'deepseek.hint': 'Set the API key named by this bundle configuration, then refresh.',
      'opencode.window.rolling': 'Rolling',
      'opencode.window.weekly': 'Weekly',
      'opencode.window.monthly': 'Monthly',
      'opencode.limited': 'limit reached',
      'opencode.resets': 'Resets {time}',
      'opencode.workspace': 'Console workspace {name}',
      'opencode.openUsage': 'Open usage page',
      'opencode.hint': 'Sign in to the OpenCode Console with the desktop app, or start a server and configure its address.',
      'hint.missingCredential': 'No API key is set for this bundle. Add it in Settings → Models, then refresh.',
      'hint.notSignedIn': 'The OpenCode Console workspace is unknown. Sign in with the OpenCode desktop app, then refresh.',
      'hint.cliMissing': 'The OpenCode CLI was not found. Set opencode.cliPath in this bundle configuration, or configure the opencode-go API key so no CLI is needed.',
      'hint.noSource': 'No OpenCode credential was found. Set the opencode-go API key (OPENCODE_GO_API_KEY) in Settings → Models, or install and sign in to the OpenCode desktop app.',
      'hint.codexNotSignedIn': 'The Codex CLI is set up but holds no OAuth token. Run `codex login` (or sign in with the Codex app), then refresh.',
      'hint.codexExpired': 'The Codex token was rejected. Run `codex login` again, then refresh.',
      'hint.codexAuthUnreadable': 'The Codex credential file could not be read. Check the path in codex.authPath.',
      'common.na': '—',
    }

    const zh = {
      'pill.deepseek': 'DeepSeek {value}',
      'pill.opencode': 'Go {value}',
      'pill.deepseekPending': 'DeepSeek …',
      'pill.opencodePending': 'Go …',
      'pill.codex': 'Codex {value}',
      'codex.window.session': '5 小时会话',
      'codex.window.weekly': '每周',
      'codex.plan': '套餐 {plan}',
      'codex.credits': '额度 ${balance}',
      'codex.creditsUnlimited': '额度不限',
      'codex.resetCredits': '存了 {count} 次重置',
      'codex.resetCreditsItem': '存入的重置',
      'codex.resetCreditsUnknown': '暂时拿不到每次重置的到期时间。',
      'codex.expiresAt': '{time} 到期',
      'codex.noExpiry': '无到期时间',
      'codex.hint': 'Codex 用量读取失败，请重新 codex login 后刷新。',
      'panel.title': '订阅用量',
      'panel.refresh': '刷新',
      'panel.refreshing': '刷新中…',
      'panel.updated': '更新于 {time}',
      'panel.never': '尚未加载',
      'panel.error': '读取用量失败：{detail}',
      'status.ok': '已连接',
      'status.unconfigured': '未配置',
      'status.error': '出错',
      'status.disabled': '已关闭',
      'status.loading': '加载中…',
      'deepseek.breakdown': '充值 {toppedUp} · 赠金 {granted}',
      'deepseek.unavailable': '当前账户余额不足以调用 API。',
      'deepseek.empty': '账户没有返回余额条目。',
      'deepseek.hint': '配置本插件指定的 API Key 后刷新。',
      'opencode.window.rolling': '滚动',
      'opencode.window.weekly': '每周',
      'opencode.window.monthly': '每月',
      'opencode.limited': '已受限',
      'opencode.resets': '{time} 重置',
      'opencode.workspace': 'Console 工作区 {name}',
      'opencode.openUsage': '打开用量页',
      'opencode.hint': '请先用桌面端登录 OpenCode Console，或启动一个 server 并在配置里填它的地址。',
      'hint.missingCredential': '本插件指定的 API Key 还没配置，请在「设置 → 模型」里填好后刷新。',
      'hint.notSignedIn': '没有找到已登录的 OpenCode Console 工作区，请先用桌面端登录后刷新。',
      'hint.cliMissing': '没找到 OpenCode CLI：可以先在本插件配置里填 opencode.cliPath，或直接配置 opencode-go 的 API Key（这样就不需要 CLI）。',
      'hint.noSource': '没有可用的 OpenCode 凭据：请在「设置 → 模型」里配置 opencode-go 的 API Key（OPENCODE_GO_API_KEY），或安装并登录 OpenCode 桌面端。',
      'hint.codexNotSignedIn': 'Codex CLI 已配置但没有 OAuth 凭据：运行 codex login（或用 Codex 应用登录）后刷新。',
      'hint.codexExpired': 'Codex 的令牌被拒绝了：重新 codex login 后刷新。',
      'hint.codexAuthUnreadable': '读不到 Codex 凭据文件，请检查 codex.authPath 配置的路径。',
      'common.na': '—',
    }

    /** Currency symbols for the balance lines DeepSeek reports. */
    const SIGNS = { CNY: '¥', USD: '$' }
    /** Allowance windows, in display order, with their bar tint class. */
    const WINDOWS = [
      { key: 'rolling', tint: 'dshuh-tint--a' },
      { key: 'weekly', tint: 'dshuh-tint--b' },
      { key: 'monthly', tint: 'dshuh-tint--c' },
    ]

    /** Create one immutable-state store with a React-compatible subscription. */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    /** Shared read state; the dock and the panel are two views of it. */
    const store = createStore({
      snapshot: null,
      error: null,
      loading: true,
      busy: false,
      open: false,
      anchor: null,
    })
    /** Newest snapshot in flight, so a double click cannot start two reads. */
    let inflight = null

    /**
     * Read the host snapshot.
     * @param force - true to bypass the host cache.
     * @returns settled promise.
     */
    function load(force) {
      if (inflight !== null) return inflight
      store.set({ busy: true })
      inflight = (async () => {
        try {
          const url = new URL(API, document.baseURI)
          if (force) url.searchParams.set('refresh', '1')
          const response = await fetch(url, { headers: { accept: 'application/json' } })
          const payload = await response.json().catch(() => null)
          if (payload === null || payload.ok !== true) {
            throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          }
          store.set({ snapshot: payload.value, error: null, loading: false })
        } catch (error) {
          store.set({ error: String(error?.message ?? error), loading: false })
        } finally {
          store.set({ busy: false })
          inflight = null
        }
      })()
      return inflight
    }

    /** Format one currency amount reported by DeepSeek. */
    function money(currency, amount) {
      const sign = SIGNS[currency]
      if (sign === undefined) return `${currency} ${amount}`
      return `${sign}${amount}`
    }

    /** Format one reset instant for the local locale. */
    function formatReset(ms) {
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleString(undefined, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    }

    /** Highest allowance percentage a provider reported, or undefined. */
    function peakPercent(allowance) {
      let peak
      for (const window of WINDOWS) {
        const value = allowance?.[window.key]
        if (value === undefined) continue
        const percent = Number(value.percent) || 0
        peak = peak === undefined ? percent : Math.max(peak, percent)
      }
      return peak === undefined ? undefined : Math.round(peak)
    }

    /** One provider entry by id. */
    function entryOf(snapshot, id) {
      return snapshot?.providers?.find((entry) => entry.id === id)
    }

    /** The pill reading for one provider. */
    function pillText(t, entry) {
      if (entry === undefined) return t('panel.never')
      if (entry.status === 'ok') {
        if (entry.id === 'deepseek') {
          const first = entry.balances?.[0]
          return t('pill.deepseek', { value: first === undefined ? t('common.na') : money(first.currency, first.total) })
        }
        const peak = peakPercent(entry.allowance)
        const label = entry.id === 'codex' ? 'pill.codex' : 'pill.opencode'
        return t(label, { value: peak === undefined ? t('common.na') : `${peak}%` })
      }
      if (entry.status === 'unconfigured' || entry.status === 'disabled') return t('pill.unconfigured')
      return t('pill.failed')
    }

    /** The pill tone: `warn` when the provider did not answer with a reading. */
    function pillTone(entry) {
      if (entry !== undefined && entry.status === 'ok') return ''
      return ' dshuh-pill--warn'
    }

    /** Localized status word for one provider. */
    function statusText(t, entry, loading) {
      if (entry === undefined) return t(loading ? 'status.loading' : 'status.error')
      return t(`status.${entry.status}`)
    }

    /** Localized, actionable hint for one failed provider entry. */
    function hintOf(t, entry) {
      const code = entry?.error?.code
      if (code === 'missing-credential') return t('hint.missingCredential')
      if (code === 'not-signed-in') return t('hint.notSignedIn')
      if (code === 'cli-missing') return t('hint.cliMissing')
      if (code === 'no-source') return t('hint.noSource')
      if (code === 'codex-not-signed-in') return t('hint.codexNotSignedIn')
      if (code === 'codex-token-expired') return t('hint.codexExpired')
      if (code === 'codex-auth-unreadable') return t('hint.codexAuthUnreadable')
      return undefined
    }

    /** One dot for a provider state. */
    function Dot(props) {
      const { entry, tone } = props
      const state = entry?.status === 'ok'
        ? (tone === 'b' ? ' dshuh-dot--b' : tone === 'c' ? ' dshuh-dot--c' : ' dshuh-dot--a')
        : ' dshuh-dot--muted'
      return h('span', { className: `dshuh-dot${state}`, 'aria-hidden': true })
    }

    /** Milliseconds in a day, for the expiry tone thresholds. */
    const DAY_MS = 24 * 60 * 60 * 1000
    /** How many credit rings the dock shows before it summarizes the rest. */
    const CREDIT_RING_LIMIT = 5

    /** The banked reset items of one provider entry. */
    function creditsOf(entry) {
      const reset = entry?.resetCredits
      return Array.isArray(reset?.items) ? reset.items : []
    }

    /**
     * Tone for one credit expiry: more than a week out is blue, within a week
     * green, within three days orange, and a credit with no expiry is muted.
     * @param expiresAt - epoch milliseconds, or 0 when the backend sent none.
     * @param now - current epoch milliseconds.
     * @returns tone class suffix.
     */
    function creditTone(expiresAt, now) {
      if (expiresAt === 0) return 'dshuh-credit--muted'
      const left = expiresAt - now
      if (left > 7 * DAY_MS) return 'dshuh-credit--blue'
      if (left > 3 * DAY_MS) return 'dshuh-credit--green'
      return 'dshuh-credit--orange'
    }

    /**
     * One ring per banked reset, coloured by how soon it expires.
     *
     * Rings rather than filled discs: the filled disc is already the channel
     * marker on every reading, so a second filled dot would read as another
     * channel instead of a credit.
     */
    function CreditDots(props) {
      const { t, items } = props
      const now = Date.now()
      const shown = items.slice(0, CREDIT_RING_LIMIT)
      return h('span', {
        className: 'dshuh-credits',
        role: 'img',
        'aria-label': t('codex.resetCredits', { count: items.length }),
        title: t('codex.resetCredits', { count: items.length }),
      },
        shown.map((item, index) => h('span', {
          key: item.id === '' ? String(index) : item.id,
          className: `dshuh-credit ${creditTone(item.expiresAt, now)}`,
        })),
        items.length > CREDIT_RING_LIMIT
          ? h('span', { className: 'dshuh-credit-more' }, `+${items.length - CREDIT_RING_LIMIT}`)
          : null,
      )
    }

    /** One pill button with a provider reading. */
    function Pill(props) {
      const { t, entry, onClick, open } = props
      const credits = entry?.id === 'codex' ? creditsOf(entry) : []
      return h('button', {
        type: 'button',
        className: `dshuh-pill${pillTone(entry)}`,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': PANEL_ID,
        'aria-label': entry === undefined
          ? t('panel.never')
          : `${entry.label}: ${pillText(t, entry)}${credits.length === 0 ? '' : `, ${t('codex.resetCredits', { count: credits.length })}`}`,
        onClick,
      },
        h(Dot, { entry, tone: entry?.id === 'deepseek' ? 'a' : entry?.id === 'codex' ? 'c' : 'b' }),
        h('span', null, pillText(t, entry)),
        credits.length === 0 ? null : h('span', { className: 'dshuh-divider', 'aria-hidden': true }),
        credits.length === 0 ? null : h(CreditDots, { t, items: credits }),
      )
    }

    /** A pill in the state before the first snapshot lands. */
    function WaitingPill(props) {
      const { label, onClick, open } = props
      return h('button', {
        type: 'button',
        className: 'dshuh-pill dshuh-pill--warn',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': PANEL_ID,
        'aria-label': label,
        onClick,
      },
        h('span', { className: 'dshuh-dot dshuh-dot--muted', 'aria-hidden': true }),
        h('span', null, label),
      )
    }

    /** The composer dock reading that opens the aggregate panel. */
    function Dock(props) {
      const { t } = props
      const state = React.useSyncExternalStore(store.subscribe, store.get, store.get)
      const rootRef = React.useRef(null)

      // A dock mount belongs to one composer; drop a panel left open when it
      // unmounts (session switch) instead of leaving a floating orphan.
      React.useEffect(() => () => { store.set({ open: false }) }, [])

      const toggle = () => {
        if (state.open) {
          store.set({ open: false })
          return
        }
        store.set({ open: true, anchor: rootRef.current })
        if (state.snapshot === null || state.error !== null) void load(false)
      }

      // Before the first snapshot there is nothing to tell the two providers
      // apart beyond their names, so the dock keeps both slots occupied to
      // spare the row a width jump when the readings arrive.
      if (state.snapshot === null && state.error === null) {
        return h('span', { className: 'dshuh-root', ref: rootRef },
          h('style', null, CSS),
          h(WaitingPill, { label: t('pill.deepseekPending'), open: state.open, onClick: toggle }),
          h(WaitingPill, { label: t('pill.opencodePending'), open: state.open, onClick: toggle }),
        )
      }

      const active = (id) => {
        const entry = entryOf(state.snapshot, id)
        return entry === undefined || entry.status === 'disabled' ? undefined : entry
      }
      const deepseek = active('deepseek')
      const opencode = active('opencode-go')
      const codex = active('codex')
      if (deepseek === undefined && opencode === undefined && codex === undefined) return null

      return h('span', { className: 'dshuh-root', ref: rootRef },
        h('style', null, CSS),
        deepseek === undefined ? null : h(Pill, { t, entry: deepseek, open: state.open, onClick: toggle }),
        opencode === undefined ? null : h(Pill, { t, entry: opencode, open: state.open, onClick: toggle }),
        codex === undefined ? null : h(Pill, { t, entry: codex, open: state.open, onClick: toggle }),
      )
    }

    /** One allowance window row. */
    function Meter(props) {
      const { t, label, value, tint } = props
      const percent = value === undefined ? 0 : Math.max(0, Math.min(100, Number(value.percent) || 0))
      return h('div', { className: 'dshuh-meter' },
        h('div', { className: 'dshuh-meter-head' },
          h('span', { className: 'dshuh-meter-label' }, label),
          h('span', { className: 'dshuh-meter-value' },
            value === undefined ? t('common.na') : `${Math.round(percent)}%`),
          value?.limited === true ? h('span', { className: 'dshuh-warn' }, t('opencode.limited')) : null,
        ),
        h('div', { className: 'dshuh-track' },
          h('div', { className: `dshuh-fill ${tint}`, style: { width: `${percent}%` } })),
        value?.resetsAt ? h('div', { className: 'dshuh-reset' }, t('opencode.resets', { time: formatReset(value.resetsAt) })) : null,
      )
    }

    /** A localized hint plus the raw host diagnostic beneath it. */
    function Notice(props) {
      const { t, entry, fallbackKey } = props
      const detail = entry?.error?.message
      const hint = hintOf(t, entry) ?? t(fallbackKey)
      return h('div', { className: 'dshuh-hint' },
        hint,
        detail === undefined ? null : h('div', { className: 'dshuh-detail' }, detail),
      )
    }

    /** DeepSeek balance block. */
    function DeepSeekBody(props) {
      const { t, entry } = props
      if (entry === undefined) return h('div', { className: 'dshuh-hint' }, t('panel.never'))
      if (entry.status === 'disabled') return h('div', { className: 'dshuh-hint' }, t('status.disabled'))
      if (entry.status !== 'ok') return h(Notice, { t, entry, fallbackKey: 'deepseek.hint' })

      const balances = entry.balances ?? []
      if (balances.length === 0) return h('div', { className: 'dshuh-hint' }, t('deepseek.empty'))
      return h('div', null,
        balances.map((balance) => h('div', { key: balance.currency, className: 'dshuh-balance-row' },
          h('div', { className: 'dshuh-balance' }, money(balance.currency, balance.total)),
          h('div', { className: 'dshuh-sub' },
            t('deepseek.breakdown', {
              toppedUp: money(balance.currency, balance.toppedUp),
              granted: money(balance.currency, balance.granted),
            })),
        )),
        entry.isAvailable === true ? null : h('div', { className: 'dshuh-warn' }, t('deepseek.unavailable')),
      )
    }

    /** OpenCode Go allowance block. */
    function OpencodeBody(props) {
      const { t, entry } = props
      if (entry === undefined) return h('div', { className: 'dshuh-hint' }, t('panel.never'))
      if (entry.status === 'disabled') return h('div', { className: 'dshuh-hint' }, t('status.disabled'))
      if (entry.status !== 'ok') return h(Notice, { t, entry, fallbackKey: 'opencode.hint' })

      return h('div', null,
        entry.workspace?.name ? h('div', { className: 'dshuh-sub' }, t('opencode.workspace', { name: entry.workspace.name })) : null,
        WINDOWS.map((window) => h(Meter, {
          key: window.key,
          t,
          label: t(`opencode.window.${window.key}`),
          value: entry.allowance?.[window.key],
          tint: window.tint,
        })),
        entry.workspace?.usageUrl
          ? h('a', {
            className: 'dshuh-link',
            href: entry.workspace.usageUrl,
            target: '_blank',
            rel: 'noreferrer',
          }, t('opencode.openUsage'))
          : null,
      )
    }

    /** The banked-reset summary, expanding to each credit and its expiry. */
    function BankedResets(props) {
      const { t, count, items } = props
      const [open, setOpen] = React.useState(false)
      return h('div', { className: 'dshuh-banked' },
        h('button', {
          type: 'button',
          className: 'dshuh-banked-toggle',
          'aria-expanded': open,
          onClick: () => { setOpen(!open) },
        },
          h('span', null, t('codex.resetCredits', { count })),
          open || items.length === 0 ? null : h(CreditDots, { t, items }),
          h('span', { className: 'dshuh-caret', 'aria-hidden': true }, open ? '▾' : '▸'),
        ),
        open
          ? h('ul', { className: 'dshuh-banked-list' },
            items.length === 0
              ? h('li', { className: 'dshuh-banked-item' }, t('codex.resetCreditsUnknown'))
              : items.map((item, index) => h('li', {
                key: item.id === '' ? String(index) : item.id,
                className: 'dshuh-banked-item',
              },
                h('span', { className: 'dshuh-banked-title' },
                  item.title === '' ? t('codex.resetCreditsItem') : item.title),
                h('span', { className: 'dshuh-banked-expiry' },
                  item.expiresAt > 0 ? t('codex.expiresAt', { time: formatReset(item.expiresAt) }) : t('codex.noExpiry')),
              )))
          : null,
      )
    }

    /** Codex subscription block: plan, the two rate-limit windows, credits. */
    function CodexBody(props) {
      const { t, entry } = props
      if (entry === undefined) return h('div', { className: 'dshuh-hint' }, t('panel.never'))
      if (entry.status === 'disabled') return h('div', { className: 'dshuh-hint' }, t('status.disabled'))
      if (entry.status !== 'ok') return h(Notice, { t, entry, fallbackKey: 'codex.hint' })

      const credits = entry.credits ?? {}
      // A count-only answer (an older Host half) still renders its summary.
      const reset = entry.resetCredits
      const resetCount = typeof reset === 'number' ? reset : Number(reset?.count ?? 0) || 0
      const resetItems = Array.isArray(reset?.items) ? reset.items : []
      return h('div', null,
        entry.plan === undefined ? null : h('div', { className: 'dshuh-sub' }, t('codex.plan', { plan: entry.plan })),
        h(Meter, {
          t,
          label: t('codex.window.session'),
          value: entry.allowance?.rolling,
          tint: 'dshuh-tint--a',
        }),
        h(Meter, {
          t,
          label: t('codex.window.weekly'),
          value: entry.allowance?.weekly,
          tint: 'dshuh-tint--c',
        }),
        credits.unlimited === true
          ? h('div', { className: 'dshuh-sub' }, t('codex.creditsUnlimited'))
          : credits.hasCredits === true
            ? h('div', { className: 'dshuh-sub' }, t('codex.credits', { balance: Number(credits.balance ?? 0).toFixed(2) }))
            : null,
        resetCount > 0 ? h(BankedResets, { t, count: resetCount, items: resetItems }) : null,
      )
    }

    /** One provider section in the panel. */
    function Section(props) {
      const { t, entry, tone, loading, children } = props
      return h('section', { className: 'dshuh-section' },
        h('div', { className: 'dshuh-section-head' },
          h(Dot, { entry, tone }),
          h('span', { className: 'dshuh-section-title' }, entry?.label ?? ''),
          h('span', { className: 'dshuh-status' }, statusText(t, entry, loading)),
        ),
        children,
      )
    }

    /** The frame overlay panel with both providers and the refresh control. */
    function Panel(props) {
      const { t } = props
      const state = React.useSyncExternalStore(store.subscribe, store.get, store.get)
      const panelRef = React.useRef(null)
      const wasOpen = React.useRef(false)
      const [placement, setPlacement] = React.useState(null)
      const loading = state.snapshot === null && state.error === null

      // The panel opens upward from the composer; the box is capped by the room
      // actually left above the dock so the header never scrolls out of reach.
      React.useEffect(() => {
        if (!state.open) return undefined
        const anchor = state.anchor
        const place = () => {
          if (anchor === null || anchor === undefined) return
          const rect = anchor.getBoundingClientRect()
          const width = Math.min(360, window.innerWidth - 24)
          const bottom = Math.max(12, window.innerHeight - rect.top + 8)
          setPlacement({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
            bottom,
            width,
            maxHeight: Math.max(120, window.innerHeight - bottom - 12),
          })
        }
        place()
        window.addEventListener('resize', place)
        return () => { window.removeEventListener('resize', place) }
      }, [state.open, state.anchor])

      // A dialog with buttons needs its own focus; give it the panel, and hand
      // focus back to the reading that opened it.
      React.useEffect(() => {
        if (state.open && placement !== null) panelRef.current?.focus()
      }, [state.open, placement])
      React.useEffect(() => {
        if (!state.open && wasOpen.current) {
          const anchor = state.anchor
          const button = anchor?.querySelector?.('button')
          if (button !== null && button !== undefined) button.focus()
        }
        wasOpen.current = state.open
      }, [state.open, state.anchor])

      React.useEffect(() => {
        if (!state.open) return undefined
        const onPointer = (event) => {
          const panel = panelRef.current
          const anchor = state.anchor
          if (panel !== null && panel.contains(event.target)) return
          if (anchor !== null && anchor !== undefined && anchor.contains(event.target)) return
          store.set({ open: false })
        }
        const onKey = (event) => {
          if (event.key === 'Escape') store.set({ open: false })
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [state.open, state.anchor])

      if (!state.open || placement === null) return null

      const deepseek = entryOf(state.snapshot, 'deepseek')
      const opencode = entryOf(state.snapshot, 'opencode-go')
      const codex = entryOf(state.snapshot, 'codex')
      const updated = state.snapshot === null
        ? t('panel.never')
        : t('panel.updated', { time: formatReset(state.snapshot.at) })

      return h('div', {
        ref: panelRef,
        id: PANEL_ID,
        className: 'dshuh-panel',
        role: 'dialog',
        tabIndex: -1,
        'aria-label': t('panel.title'),
        style: {
          left: `${placement.left}px`,
          bottom: `${placement.bottom}px`,
          width: `${placement.width}px`,
          maxHeight: `${placement.maxHeight}px`,
        },
      },
        h('style', null, CSS),
        h('div', { className: 'dshuh-head' },
          h('span', { className: 'dshuh-title' }, t('panel.title')),
          h('span', { className: 'dshuh-updated' }, updated),
          h('button', {
            type: 'button',
            className: 'dshuh-refresh',
            'aria-disabled': state.busy,
            'aria-busy': state.busy,
            onClick: () => { if (!state.busy) void load(true) },
          }, state.busy ? t('panel.refreshing') : t('panel.refresh')),
        ),
        h(Section, { t, entry: deepseek, tone: 'a', loading }, h(DeepSeekBody, { t, entry: deepseek })),
        h(Section, { t, entry: opencode, tone: 'b', loading }, h(OpencodeBody, { t, entry: opencode })),
        h(Section, { t, entry: codex, tone: 'c', loading }, h(CodexBody, { t, entry: codex })),
        state.error === null ? null : h('div', { className: 'dshuh-error', role: 'alert' },
          t('panel.error', { detail: state.error })),
      )
    }

    /** Scoped styles; theme tokens only, so light and dark both inherit. */
    const CSS = `
.dshuh-root { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.dshuh-pill {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  padding: 1px 8px; border: none; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font-family: inherit; font-size: var(--dsh-content-font-size-secondary, 13px);
  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer;
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.dshuh-pill[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
@media (hover: hover) {
  .dshuh-pill:hover {
    background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
  }
}
.dshuh-pill--warn { color: var(--dsw-alias-label-tertiary); }
.dshuh-dot { width: 6px; height: 6px; border-radius: 999px; flex: none; background: var(--dsw-alias-label-tertiary); }
.dshuh-dot--a { background: var(--dsw-alias-chart-system, var(--dsw-alias-label-tertiary)); }
.dshuh-dot--b { background: var(--dsw-alias-chart-tools, var(--dsw-alias-label-tertiary)); }
.dshuh-dot--c { background: var(--dsw-alias-chart-messages, var(--dsw-alias-label-tertiary)); }
.dshuh-dot--muted { background: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); }
.dshuh-panel {
  position: fixed; z-index: 1100; box-sizing: border-box;
  padding: 12px; border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary);
  cursor: default; overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dshuh-panel:focus { outline: none; }
.dshuh-head { display: flex; align-items: center; gap: 8px; }
.dshuh-title { font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshuh-updated { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dshuh-refresh {
  border: none; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; padding: 1px 6px;
}
.dshuh-refresh:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshuh-refresh[aria-disabled='true'] { opacity: .6; cursor: progress; }
.dshuh-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dshuh-section-head { display: flex; align-items: center; gap: 6px; }
.dshuh-section-title { font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshuh-status { margin-left: auto; color: var(--dsw-alias-label-tertiary); }
.dshuh-balance-row + .dshuh-balance-row { margin-top: 6px; }
.dshuh-balance { font-size: 20px; line-height: 28px; font-weight: 500; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshuh-sub { color: var(--dsw-alias-label-tertiary); }
.dshuh-hint { margin-top: 4px; color: var(--dsw-alias-label-secondary); }
.dshuh-detail { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); }
.dshuh-warn { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-primary)); font-weight: 500; }
.dshuh-meter { margin-top: 8px; }
.dshuh-meter-head { display: flex; align-items: center; gap: 6px; }
.dshuh-meter-label { color: var(--dsw-alias-label-secondary); }
.dshuh-meter-value { margin-left: auto; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshuh-track { margin-top: 4px; height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.dshuh-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-label-tertiary); }
.dshuh-fill.dshuh-tint--a { background: var(--dsw-alias-chart-system, var(--dsw-alias-label-tertiary)); }
.dshuh-fill.dshuh-tint--b { background: var(--dsw-alias-chart-tools, var(--dsw-alias-label-tertiary)); }
.dshuh-fill.dshuh-tint--c { background: var(--dsw-alias-chart-messages, var(--dsw-alias-label-tertiary)); }
.dshuh-reset { color: var(--dsw-alias-label-tertiary); }
.dshuh-banked { margin-top: 6px; }
.dshuh-banked-toggle {
  display: inline-flex; align-items: center; gap: 6px; padding: 0;
  border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; cursor: pointer;
}
.dshuh-banked-toggle:hover { color: var(--dsw-alias-label-primary); }
.dshuh-caret { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dshuh-divider {
  width: 1px; height: 10px; flex: none; margin: 0 2px;
  background: var(--dsw-alias-border-l2);
}
/* Banked credits are rings, not discs: the filled disc is the channel marker. */
.dshuh-credits { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.dshuh-credit {
  box-sizing: border-box; width: 5px; height: 5px; flex: none;
  border-radius: 999px; border: 1.5px solid currentColor; background: transparent;
  color: var(--dsw-alias-label-tertiary);
}
.dshuh-credit--blue { color: var(--dsw-alias-chart-messages, var(--dsw-alias-label-secondary)); }
.dshuh-credit--green { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary)); }
.dshuh-credit--orange { color: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-secondary)); }
.dshuh-credit--muted { color: var(--dsw-alias-border-l3); }
.dshuh-credit-more { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dshuh-banked-list { margin: 4px 0 0; padding: 0 0 0 14px; list-style: none; }
.dshuh-banked-item {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 2px 0; color: var(--dsw-alias-label-tertiary);
}
.dshuh-banked-title { color: var(--dsw-alias-label-secondary); }
.dshuh-banked-expiry { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dshuh-link { display: inline-block; margin-top: 8px; color: var(--dsw-alias-label-secondary); text-decoration: underline; }
.dshuh-link:hover { color: var(--dsw-alias-label-primary); }
.dshuh-error {
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-secondary));
}
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'usage-hub: dictionaries')
        ctx.effect(() => {
          void load(false)
          const timer = setInterval(() => { void load(false) }, POLL_MS)
          return () => { clearInterval(timer) }
        }, 'usage-hub: snapshot polling')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'usage-hub.reading',
          order: 6,
          locale: NS,
        }, Dock))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'usage-hub.panel',
          order: 45,
          locale: NS,
        }, Panel))
      },
    }
  },
})
