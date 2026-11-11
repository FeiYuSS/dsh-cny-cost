window.__ModuleLoader__.load({
  id: 'dsh-cny-cost',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const COST_KEY = 'deepseekTokenCost';
    const TURN_KEY = 'deepseekTurnCost';
    const NANO = 1e9;
    const MEASURE_STYLE = { position: 'fixed', top: '0px', left: '0px', visibility: 'hidden' };
    // Every assistant action row mounts its own control; one projection refresh
    // per Session is enough because the projection face is shared by all of them.
    const refreshedProjections = new Set();
    let idCounter = 0;

    // -----------------------------------------------------------------------
    // Text. View text follows the active locale read from the Client locale
    // service; the plugin metadata locale files cover its title/description.
    // -----------------------------------------------------------------------
    const TEXT = {
      en: {
        composerAria: 'Theoretical cost of DeepSeek official models: {cost}',
        composerTipTitle: 'DeepSeek official models · theoretical cost',
        composerTipTotal: '≈¥{cost} · {calls} calls',
        composerTipPeriods: 'Peak ¥{peak} · off-peak ¥{idle}',
        tipOpenHint: 'Click for the breakdown',
        totalValue: '≈ ¥{cost}',
        periodPeakIdle: 'Peak ¥{peak} · off-peak ¥{idle}',
        tokenCount: '{count} tokens',
        turnAria: 'Theoretical cost of this turn: {cost}',
        turnTipTitle: 'This turn ≈¥{cost} · total ≈¥{total}',
        turnTipTokens: 'cache hit {hit} · cache miss {miss} · output {out}',
        turnTipMeta: '{period} · {family} · {calls} calls',
        turnTipOpenHint: 'Click for this turn’s breakdown',
        panelTitle: 'Token cost detail',
        turnPanelTitle: 'This turn’s cost',
        subtitle: 'Theoretical cost · DeepSeek official pricing ({date} snapshot)',
        breakdown: 'Pricing breakdown',
        'bucket.hit': 'Input · cache hit',
        'bucket.miss': 'Input · cache miss',
        'bucket.write': 'Input · cache write',
        'bucket.out': 'Output',
        formula: '{tokens} × ¥{rate}/{unit} = ¥{cost}',
        unit: 'M tokens',
        'period.peak': 'Peak',
        'period.idle': 'Off-peak',
        'period.mixed': 'Peak + off-peak',
        'period.none': 'Not priced',
        turns: 'Per-turn',
        turnsRecent: 'last {count}',
        unpriced: '{count} non-official model call(s) excluded from pricing',
        note: 'Theoretical value, priced by each request’s completion time. Peak = Beijing workdays 09:00–12:00 and 14:00–18:00 (PRC statutory holidays excluded). Search/Fetch request fees are not included.',
        source: 'Source: api-docs.deepseek.com/zh-cn/quick_start/pricing',
        mixedHint: 'This turn used more than one model; per-model prices are in the session cost detail.',
        watchTitle: 'Official pricing auto-check',
        watchDescription: 'Compares the official DeepSeek pricing page with the snapshot bundled in this plugin. When it changes, a dialog offers to start a session that updates the plugin rules.',
        watchAutoCheck: 'Check for pricing updates automatically',
        watchInterval: 'Check interval',
        watchUnitHours: 'hours',
        watchUnitDays: 'days',
        watchSave: 'Save interval',
        watchSaved: 'Saved',
        watchIntervalInvalid: 'The interval must be between 1 hour and 30 days',
        watchCheckNow: 'Check now',
        watchChecking: 'Checking…',
        watchManualUpdate: 'Start rule update now',
        watchOpenOfficial: 'Open the official pricing page',
        watchLastCheck: 'Last check',
        watchNextCheck: 'Next check',
        watchNever: 'Never',
        watchDisabled: 'Automatic checks are off',
        watchBaseline: 'Acknowledged snapshot',
        watchBaselineBundled: 'Bundled with the plugin',
        watchMirror: 'Mirror',
        watchSource: 'Source',
        watchPending: 'Pending changes',
        watchNoPending: 'None',
        watchStatusOk: 'up to date',
        watchStatusIgnored: 'update ignored',
        watchStatusError: 'failed',
        watchModalTitle: 'Official pricing may have changed',
        watchModalSubtitle: 'Detected while polling the static mirror of the official pricing source.',
        watchModalChanges: 'Detected changes',
        watchModalNote: 'Confirming starts a new session with a prepared prompt; the agent reviews the official page, updates the plugin source (logic.js, tests, docs) and reports back. It does not publish anything until you confirm.',
        watchClose: 'Close',
        watchIgnore: 'Ignore this update',
        watchStartUpdate: 'Start update session',
        watchStarting: 'Starting…',
        watchSessionStarted: 'A session with the update prompt was created. Open it from the sidebar to continue.',
        watchClipboardCopied: 'Could not create the session, so the update prompt was copied to the clipboard.',
        watchSessionError: 'Could not create the session or copy the prompt.',
        watchPendingInSettings: 'Detected while you were here; open the dialog from any conversation or use “Start rule update now”.',
        watchCorsNote: 'The browser cannot read api-docs.deepseek.com directly (the site sends no CORS header). A GitHub Actions job mirrors the official markdown into this repository; the browser polls that static snapshot. Expect up to one hour of latency.',
        watchStale: 'The mirror has not been refreshed for over a week; GitHub Actions may be disabled.',
        'detail.period': 'Period',
        'detail.model': 'Model',
        'detail.calls': 'Calls',
        'detail.tokens': 'Tokens',
        'detail.sessionTokens': 'Session tokens',
      },
      zh: {
        composerAria: 'DeepSeek 官方模型理论成本：{cost}',
        composerTipTitle: 'DeepSeek 官方模型 · 理论成本',
        composerTipTotal: '≈¥{cost} · {calls} 次调用',
        composerTipPeriods: '高峰 ¥{peak} · 空闲 ¥{idle}',
        tipOpenHint: '点击查看明细',
        totalValue: '≈ ¥{cost}',
        periodPeakIdle: '高峰 ¥{peak} · 空闲 ¥{idle}',
        tokenCount: '{count} tokens',
        turnAria: '本回合理论成本：{cost}',
        turnTipTitle: '本回合 ≈¥{cost} · 累计 ≈¥{total}',
        turnTipTokens: '缓存命中 {hit} · 未命中 {miss} · 输出 {out}',
        turnTipMeta: '{period} · {family} · {calls} 次调用',
        turnTipOpenHint: '点击查看本回合明细',
        panelTitle: 'Token 费用明细',
        turnPanelTitle: '本回合费用',
        subtitle: '理论成本 · DeepSeek 官方定价（{date} 快照）',
        breakdown: '计费构成',
        'bucket.hit': '输入 · 缓存命中',
        'bucket.miss': '输入 · 缓存未命中',
        'bucket.write': '输入 · 缓存写入',
        'bucket.out': '输出',
        formula: '{tokens} × ¥{rate}/{unit} = ¥{cost}',
        unit: '百万 tokens',
        'period.peak': '高峰',
        'period.idle': '空闲',
        'period.mixed': '高峰 + 空闲',
        'period.none': '未计价',
        turns: '每回合',
        turnsRecent: '最近 {count} 个',
        unpriced: '{count} 次非官方模型调用未计价',
        note: '理论值：按每次请求完成时刻归入高峰/空闲。高峰为北京时间工作日 09:00–12:00、14:00–18:00（不含中国法定节假日）。搜索/抓取按次计费不计入。',
        source: '价格来源：api-docs.deepseek.com/zh-cn/quick_start/pricing',
        mixedHint: '本回合包含多个模型，分模型单价见会话费用明细。',
        watchTitle: '官方定价自动检查',
        watchDescription: '定期比对 DeepSeek 官方定价页与插件内置快照；发现变化时弹窗询问是否新建会话更新插件计费规则。',
        watchAutoCheck: '自动检查定价更新',
        watchInterval: '检查周期',
        watchUnitHours: '小时',
        watchUnitDays: '天',
        watchSave: '保存周期',
        watchSaved: '已保存',
        watchIntervalInvalid: '检查周期需在 1 小时到 30 天之间',
        watchCheckNow: '立即检查',
        watchChecking: '检查中…',
        watchManualUpdate: '手动发起规则更新',
        watchOpenOfficial: '打开官方价格页',
        watchLastCheck: '上次检查',
        watchNextCheck: '下次检查',
        watchNever: '从未',
        watchDisabled: '自动检查已关闭',
        watchBaseline: '已确认快照',
        watchBaselineBundled: '随插件内置',
        watchMirror: '镜像',
        watchSource: '数据源',
        watchPending: '待确认变更',
        watchNoPending: '无',
        watchStatusOk: '已是最新',
        watchStatusIgnored: '已忽略的变更',
        watchStatusError: '失败',
        watchModalTitle: '官方定价可能已更新',
        watchModalSubtitle: '轮询官方定价源的静态镜像时检测到变化。',
        watchModalChanges: '检测到的变化',
        watchModalNote: '确认后会新建一个会话并预填更新提示词：Agent 会核对官方页面、更新插件源码（logic.js、测试、文档）并向你汇报；在你确认发布前不会推送或发版。',
        watchClose: '关闭',
        watchIgnore: '忽略此次更新',
        watchStartUpdate: '新建会话并更新规则',
        watchStarting: '正在创建…',
        watchSessionStarted: '已新建带更新提示词的会话，请在侧边栏打开继续。',
        watchClipboardCopied: '无法直接新建会话，更新提示词已复制到剪贴板。',
        watchSessionError: '无法新建会话，也无法复制提示词。',
        watchPendingInSettings: '在这里检测到变更；可在任意会话打开弹窗，或点击「手动发起规则更新」。',
        watchCorsNote: '浏览器无法直接读取 api-docs.deepseek.com（官方站不返回 CORS 头）。由 GitHub Actions 定时把官方 markdown 镜像到本仓库，浏览器轮询该静态快照；最多约 1 小时延迟。',
        watchStale: '镜像超过一周未更新，GitHub Actions 可能被禁用。',
        'detail.period': '时段',
        'detail.model': '模型',
        'detail.calls': '调用',
        'detail.tokens': 'Tokens',
        'detail.sessionTokens': '会话 tokens',
      },
    };

    const FAMILY_LABEL = { flash: 'Flash', pro: 'Pro', mixed: 'Flash + Pro' };

    function pickLang(raw) {
      return typeof raw === 'string' && raw.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }

    function translate(lang, key, vars) {
      const dict = TEXT[lang] || TEXT.en;
      let value = dict[key] !== undefined ? dict[key] : (TEXT.en[key] !== undefined ? TEXT.en[key] : key);
      if (vars) {
        for (const name of Object.keys(vars)) value = value.split('{' + name + '}').join(String(vars[name]));
      }
      return value;
    }

    // -----------------------------------------------------------------------
    // Formatting
    // -----------------------------------------------------------------------
    function groupThousands(integer) {
      return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatCNY(nano) {
      const value = (Number(nano) || 0) / NANO;
      if (value === 0) return '0';
      const decimals = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
      const parts = value.toFixed(decimals).split('.');
      return parts.length > 1 ? groupThousands(parts[0]) + '.' + parts[1] : groupThousands(parts[0]);
    }

    function trimNumber(value) {
      let text = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
      if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
      return text;
    }

    const TOKEN_TIERS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

    function formatTokens(count) {
      const value = Number(count) || 0;
      for (let index = 0; index < TOKEN_TIERS.length; index += 1) {
        const [unit, suffix] = TOKEN_TIERS[index];
        if (value < unit) continue;
        let scaled = value / unit;
        let label = suffix;
        // 999_950 must read as 1M, not 1000K.
        if (index > 0 && scaled >= 999.95) {
          [scaled, label] = [value / TOKEN_TIERS[index - 1][0], TOKEN_TIERS[index - 1][1]];
        }
        return trimNumber(scaled) + label;
      }
      return String(Math.round(value));
    }

    function formatRate(rate) {
      return String(Number(rate) || 0);
    }

    function bucketCostNano(tokens, ratePerMillion) {
      return Math.round(tokens * Math.round(ratePerMillion * 1000));
    }

    function rateMap(view) {
      const map = {};
      if (!view || !Array.isArray(view.rates)) return map;
      for (const entry of view.rates) {
        map[entry.family] = {
          peak: { hit: entry.peak.hit, miss: entry.peak.miss, out: entry.peak.out, write: entry.write },
          idle: { hit: entry.idle.hit, miss: entry.idle.miss, out: entry.idle.out, write: entry.write },
        };
      }
      return map;
    }

    function totalTokens(tokens) {
      if (!tokens) return 0;
      return (tokens.hit || 0) + (tokens.miss || 0) + (tokens.write || 0) + (tokens.out || 0);
    }

    function periodLabel(t, period) {
      if (period === 'peak') return t('period.peak');
      if (period === 'idle') return t('period.idle');
      if (period === 'mixed') return t('period.mixed');
      return t('period.none');
    }

    function familyLabel(family) {
      if (family === null || family === undefined) return '—';
      return FAMILY_LABEL[family] || family;
    }

    function cumulativeCost(turns, turnNumber) {
      let total = 0;
      for (const record of turns) {
        if (record.turn <= turnNumber) total += record.costNano;
      }
      return total;
    }

    // -----------------------------------------------------------------------
    // Icons
    // -----------------------------------------------------------------------
    function IconCoin() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('circle', { cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M5.6 5.6 8 8.4l2.4-2.8M8 8.4v3.1M6.4 9.5h3.2M6.4 10.9h3.2',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
        }));
    }

    // -----------------------------------------------------------------------
    // Hooks over documented Client services
    // -----------------------------------------------------------------------
    function useLocale(ctx) {
      const locale = ctx.get('locale');
      const subscribe = React.useCallback(
        (onChange) => (locale && typeof locale.subscribe === 'function' ? locale.subscribe(onChange) : () => {}),
        [locale],
      );
      const getSnapshot = React.useCallback(
        () => (locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null),
        [locale],
      );
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en';
      const lang = pickLang(active);
      return { lang, t: (key, vars) => translate(lang, key, vars) };
    }

    /** Subscribe to one session projection value of the viewed Session. */
    function useProjection(ctx, sessionId, key) {
      const sessions = ctx.get('sessions');
      const [attempt, setAttempt] = React.useState(0);

      React.useEffect(() => {
        setAttempt(0);
      }, [sessionId]);

      React.useEffect(() => {
        if (!sessions || !sessionId || typeof sessions.refreshProjections !== 'function') return;
        if (refreshedProjections.has(sessionId)) return;
        refreshedProjections.add(sessionId);
        try {
          const pending = sessions.refreshProjections(sessionId);
          if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        } catch {
          /* projection refresh is best-effort; the next snapshot still arrives */
        }
      }, [sessions, sessionId]);

      const source = React.useMemo(() => {
        if (!sessions || !sessionId || typeof sessions.binding !== 'function') return null;
        try {
          const binding = sessions.binding(sessionId);
          const projections = binding && binding.session && binding.session.projections;
          if (!projections || typeof projections.faceOf !== 'function') return null;
          return projections.faceOf(key) || null;
        } catch {
          return null;
        }
      }, [sessions, sessionId, key, attempt]);

      React.useEffect(() => {
        if (source || !sessions || !sessionId || attempt >= 10) return undefined;
        const timer = setTimeout(() => setAttempt((value) => value + 1), 400);
        return () => clearTimeout(timer);
      }, [source, sessions, sessionId, attempt]);

      const subscribe = React.useCallback(
        (onChange) => (source && typeof source.subscribe === 'function' ? source.subscribe(onChange) : () => {}),
        [source],
      );
      const getSnapshot = React.useCallback(() => {
        if (!source || typeof source.getSnapshot !== 'function') return undefined;
        try {
          return source.getSnapshot();
        } catch {
          return undefined;
        }
      }, [source]);

      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    /**
     * Fixture-free placement for a portaled panel: anchors above the trigger,
     * clamped into the viewport, re-measured on resize and scroll.
     */
    function useAnchoredPosition(open, anchorRef, panelRef, gap = 8, margin = 12) {
      const [style, setStyle] = React.useState(null);
      React.useLayoutEffect(() => {
        if (!open) {
          setStyle(null);
          return undefined;
        }
        const place = () => {
          const anchor = anchorRef.current;
          const panel = panelRef.current;
          if (!anchor || !panel || typeof window === 'undefined') return;
          const rect = anchor.getBoundingClientRect();
          const available = Math.max(160, rect.top - gap - margin);
          panel.style.maxHeight = Math.round(available) + 'px';
          const width = panel.offsetWidth;
          const height = Math.min(panel.offsetHeight, available);
          const top = Math.max(margin, rect.top - gap - height);
          const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - width - margin),
          );
          setStyle((previous) => (
            previous !== null
              && previous.top === Math.round(top)
              && previous.left === Math.round(left)
              && previous.maxHeight === Math.round(available)
              ? previous
              : { top: Math.round(top), left: Math.round(left), maxHeight: Math.round(available) }
          ));
        };
        place();
        const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(place) : 0;
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          if (frame) cancelAnimationFrame(frame);
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, anchorRef, panelRef, gap, margin]);
      return style;
    }

    /** Trigger-anchored dialog seat: open state plus outside-click and Escape close. */
    function useStatDialog() {
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const restoreFocusRef = React.useRef(null);
      React.useEffect(() => {
        if (!open) return undefined;
        restoreFocusRef.current = typeof document === 'undefined' ? null : document.activeElement;
        const panel = panelRef.current;
        if (panel && typeof panel.focus === 'function') panel.focus();
        return () => {
          const previous = restoreFocusRef.current;
          restoreFocusRef.current = null;
          if (previous && typeof previous.focus === 'function') previous.focus();
        };
      }, [open]);
      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current && rootRef.current.contains(target)) return;
          if (panelRef.current && panelRef.current.contains(target)) return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open]);
      return { open, setOpen, rootRef, panelRef };
    }

    /** Delayed hover reading bubble (keyboard focus opens it immediately). */
    function useHoverBubble(delay = 200) {
      const [visible, setVisible] = React.useState(false);
      const panelRef = React.useRef(null);
      const timerRef = React.useRef(null);
      const clear = () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
      const enter = React.useCallback(() => {
        clear();
        timerRef.current = setTimeout(() => setVisible(true), delay);
      }, [delay]);
      const enterNow = React.useCallback(() => {
        clear();
        setVisible(true);
      }, []);
      const leave = React.useCallback(() => {
        clear();
        setVisible(false);
      }, []);
      React.useEffect(() => () => clear(), []);
      return { visible, panelRef, enter, enterNow, leave };
    }

    /**
     * Resolve the turn whose closing Assistant message owns this action row.
     * Prefers the cost projection's recorded message id; the Chat snapshot is
     * the fallback for hosts whose projection generation predates it.
     * Called only from the variant that knows the host passes `useChat`.
     */
    function useChatTurnForMessage(useChat, messageId) {
      return useChat((snapshot) => {
        try {
          const timeline = snapshot && snapshot.timeline;
          const turns = timeline && timeline.turns;
          if (!turns) return null;
          let found = null;
          const inspect = (record, turn) => {
            if (found !== null) return;
            const data = record && record.data;
            const tail = data && typeof data.get === 'function' ? data.get('turn-tail') : undefined;
            const id = tail && tail.closing && tail.closing.finalNode ? tail.closing.finalNode.messageId : undefined;
            if (id !== undefined && id === messageId) found = turn;
          };
          if (typeof turns.forEach === 'function') {
            turns.forEach((record, turn) => inspect(record, turn));
          } else if (typeof turns === 'object') {
            for (const key of Object.keys(turns)) inspect(turns[key], Number(key));
          }
          return found;
        } catch {
          return null;
        }
      });
    }

    function findTurnRecord(data, messageId, chatTurn) {
      if (!data || !Array.isArray(data.turns)) return null;
      if (typeof messageId === 'string') {
        for (const record of data.turns) {
          if (record.pricedAttempts > 0 && record.messageId === messageId) return record;
        }
      }
      if (typeof chatTurn === 'number') {
        for (const record of data.turns) {
          if (record.pricedAttempts > 0 && record.turn === chatTurn) return record;
        }
      }
      return null;
    }

    // -----------------------------------------------------------------------
    // Styles — metrics copied from the host's statistics pills and statistics
    // dialog, renamed under the dsh-tc prefix, expressed with theme tokens.
    // -----------------------------------------------------------------------
    const CSS = [
      '.dsh-tc-anchor{display:inline-flex;min-width:0}',
      '.dsh-tc-composer-anchor{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dsh-tc-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap}',
      '.dsh-tc-pill svg{flex:none;width:14px;height:14px}',
      'button.dsh-tc-pill{cursor:pointer}',
      'button.dsh-tc-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){button.dsh-tc-pill:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}}',
      'button.dsh-tc-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-tc-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-tc-turn-anchor{min-width:0}',
      '.dsh-tc-turn-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}',
      '.dsh-tc-turn-pill svg{flex:none;width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}',
      '.dsh-tc-turn-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '@media (hover:hover){.dsh-tc-turn-pill:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}',
      '.dsh-tc-turn-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '@media (width<=480px){.dsh-tc-turn-pill{width:calc(28px + var(--dsh-content-font-delta,0px));justify-content:center;padding:6px}.dsh-tc-turn-label{display:none}}',
      '.dsh-tc-bubble{position:fixed;z-index:2147483001;box-sizing:border-box;max-width:320px;padding:6px 8px;pointer-events:none;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);box-shadow:var(--dsw-elevation-prominent,0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent));font-size:12px;line-height:18px;text-align:left}',
      '.dsh-tc-bubble-line{display:block}',
      '.dsh-tc-bubble-strong{font-weight:600;font-variant-numeric:tabular-nums}',
      '.dsh-tc-bubble-muted{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px}',
      '.dsh-tc-panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));overflow:hidden auto;padding:16px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);border:0;border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent));font-size:12px;line-height:18px;text-align:left}',
      '.dsh-tc-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dsh-tc-title-label{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-tc-title-label svg{flex:none;width:14px;height:14px}',
      '.dsh-tc-title-value{font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dsh-tc-rule{border-top:1px solid var(--dsw-alias-border-l1);margin-bottom:10px}',
      '.dsh-tc-sub{margin-bottom:8px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.dsh-tc-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.dsh-tc-details dt,.dsh-tc-details dd{min-width:0;margin:0}',
      '.dsh-tc-details dd{color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}',
      '.dsh-tc-section{margin-top:12px}',
      '.dsh-tc-section-title{margin-bottom:4px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;font-weight:600}',
      '.dsh-tc-model{margin-top:6px}',
      '.dsh-tc-model-title{color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-period{margin:2px 0 0 8px}',
      '.dsh-tc-period-title{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px}',
      '.dsh-tc-row{display:flex;justify-content:space-between;gap:12px}',
      '.dsh-tc-row-label{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.dsh-tc-row-value{font-variant-numeric:tabular-nums}',
      '.dsh-tc-note{margin-top:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px}',
      '.dsh-tc-turn-list{display:grid;gap:2px}',
      '.dsh-tc-turn-line{display:flex;justify-content:space-between;gap:12px}',
      // ---- official pricing watch -------------------------------------------------
      '.dsh-tc-watch{display:grid;gap:4px;max-width:720px}',
      '.dsh-tc-watch h3{margin:0 0 4px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-watch-desc{margin:0 0 12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-tc-watch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1);min-height:32px}',
      '.dsh-tc-watch-row-label{color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-watch-row-value{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));text-align:right;font-variant-numeric:tabular-nums;word-break:break-all}',
      '.dsh-tc-watch-actions{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0 4px}',
      '.dsh-tc-watch-note{margin:12px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;line-height:17px}',
      '.dsh-tc-watch-note[data-kind=warn]{color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-watch-changes{margin:8px 0 0;padding-left:18px;display:grid;gap:4px;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}',
      '.dsh-tc-watch-change{line-height:18px}',
      '.dsh-tc-watch-link{color:var(--dsw-alias-brand-primary);text-decoration:none}',
      '.dsh-tc-watch-link:hover{text-decoration:underline}',
      '.dsh-tc-input{box-sizing:border-box;width:88px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}',
      '.dsh-tc-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);overflow:hidden}',
      '.dsh-tc-seg button{border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;padding:5px 10px;cursor:pointer}',
      '.dsh-tc-seg button[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--dsw-radius-sm,6px);border:1px solid transparent;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
      '.dsh-tc-btn:disabled{opacity:.55;cursor:default}',
      '.dsh-tc-btn-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}',
      '.dsh-tc-btn-outline{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.dsh-tc-btn-ghost{color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){.dsh-tc-btn-ghost:hover,.dsh-tc-btn-outline:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '.dsh-tc-modal-backdrop{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 32%,transparent)}',
      '.dsh-tc-modal{box-sizing:border-box;width:min(560px,100%);max-height:min(80vh,720px);overflow:auto;padding:20px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent));font-size:13px;line-height:20px}',
      '.dsh-tc-modal-title{margin:0 0 6px;font-size:15px;font-weight:600}',
      '.dsh-tc-modal-sub{margin:0 0 10px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-tc-modal-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.dsh-tc-toast{position:fixed;right:20px;bottom:20px;z-index:2147483003;max-width:360px;padding:10px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent));font-size:13px;line-height:19px}',
      '.dsh-tc-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}',
      '.dsh-tc-switch input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
    ].join('');

    /**
     * Inject the static stylesheet once per page. Client HMR may re-run this
     * module in place, so the tag itself is the guard against duplicates.
     */
    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.querySelector('style[data-dsh-cny-cost]')) return;
      const style = document.createElement('style');
      style.setAttribute('data-dsh-cny-cost', '');
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /** Page-unique ids for one control's bubble and panel. */
    function useControlIds() {
      const ref = React.useRef(null);
      if (ref.current === null) {
        idCounter += 1;
        ref.current = {
          panel: 'dsh-cny-cost-panel-' + idCounter,
          bubble: 'dsh-cny-cost-bubble-' + idCounter,
        };
      }
      return ref.current;
    }

    // -----------------------------------------------------------------------
    // Shared pieces
    // -----------------------------------------------------------------------
    function BubbleLine(props) {
      return h('span', {
        className: 'dsh-tc-bubble-line' + (props.className ? ' ' + props.className : ''),
      }, props.children);
    }

    function titleBlock(t, title, value) {
      return h(React.Fragment, null,
        h('div', { className: 'dsh-tc-title' }, [
          h('span', { key: 'label', className: 'dsh-tc-title-label' }, [h(IconCoin, { key: 'icon' }), title]),
          h('span', { key: 'value', className: 'dsh-tc-title-value' }, value),
        ]),
        h('div', { className: 'dsh-tc-rule', 'aria-hidden': 'true' }));
    }

    function detailRows(t, rows) {
      const children = [];
      for (const row of rows) {
        if (row === null || row === undefined) continue;
        children.push(h('dt', { key: 'dt-' + children.length }, row.label));
        children.push(h('dd', { key: 'dd-' + children.length }, row.value));
      }
      if (children.length === 0) return null;
      return h('dl', { className: 'dsh-tc-details' }, children);
    }

    function formulaRows(t, rates, family, periodKey, tokens) {
      const familyRates = family ? rates[family] : null;
      const rate = familyRates ? familyRates[periodKey] : null;
      const rows = [];
      const buckets = [
        ['hit', tokens.hit],
        ['miss', tokens.miss],
        ['write', tokens.write],
        ['out', tokens.out],
      ];
      for (const entry of buckets) {
        const bucket = entry[0];
        const count = entry[1];
        if (!count) continue;
        const price = rate ? rate[bucket] : null;
        rows.push(h('div', { key: bucket, className: 'dsh-tc-row' }, [
          h('span', { key: 'l', className: 'dsh-tc-row-label' }, t('bucket.' + bucket)),
          h('span', { key: 'v', className: 'dsh-tc-row-value' }, price === null
            ? formatTokens(count) + ' tokens'
            : t('formula', {
              tokens: formatTokens(count),
              rate: formatRate(price),
              unit: t('unit'),
              cost: formatCNY(bucketCostNano(count, price)),
            })),
        ]));
      }
      return rows;
    }

    // -----------------------------------------------------------------------
    // Session-wide detail dialog
    // -----------------------------------------------------------------------
    function SessionCostPanel(props) {
      const t = props.t;
      const data = props.data;
      const turnData = useProjection(props.__ctx, props.sessionId, TURN_KEY);
      const totals = data.totals;
      const rates = rateMap(data);
      const turns = turnData && Array.isArray(turnData.turns) ? turnData.turns : [];

      const sections = [];
      sections.push(h('div', { key: 'title' }, titleBlock(
        t,
        t('panelTitle'),
        t('totalValue', { cost: formatCNY(totals.costNano) }),
      )));
      sections.push(h('div', { key: 'sub', className: 'dsh-tc-sub' }, t('subtitle', { date: data.rateDate })));
      sections.push(h('div', { key: 'details' }, detailRows(t, [
        { label: t('detail.sessionTokens'), value: t('tokenCount', { count: formatTokens(totalTokens(totals.tokens)) }) },
        { label: t('detail.calls'), value: String(totals.pricedAttempts) },
        { label: t('detail.period'), value: t('periodPeakIdle', {
          peak: formatCNY(data.periods.peak.costNano),
          idle: formatCNY(data.periods.idle.costNano),
        }) },
      ])));

      const breakdown = [];
      for (const model of data.models) {
        if (!model.family || model.attempts < 1) continue;
        const periods = [];
        for (const periodKey of ['peak', 'idle']) {
          const period = model[periodKey];
          if (!period || !period.attempts) continue;
          const rows = formulaRows(t, rates, model.family, periodKey, period.tokens);
          if (rows.length === 0) continue;
          periods.push(h('div', { key: periodKey, className: 'dsh-tc-period' }, [
            h('div', { key: 'title', className: 'dsh-tc-period-title' }, periodLabel(t, periodKey) + ' · ' + formatCNY(period.costNano)),
          ].concat(rows)));
        }
        if (periods.length === 0) continue;
        breakdown.push(h('div', { key: 'model-' + model.provider + '/' + model.model, className: 'dsh-tc-model' }, [
          h('div', { key: 'title', className: 'dsh-tc-model-title' }, model.model + ' · ' + familyLabel(model.family)),
          h('div', { key: 'body' }, periods),
        ]));
      }
      if (breakdown.length > 0) {
        sections.push(h('div', { key: 'breakdown', className: 'dsh-tc-section' }, [
          h('div', { key: 'title', className: 'dsh-tc-section-title' }, t('breakdown')),
          h('div', { key: 'body' }, breakdown),
        ]));
      }

      const recent = turns.filter((record) => record.attempts > 0).slice(-8);
      if (recent.length > 0) {
        const rows = recent.map((record) => h('div', { key: 'turn-' + record.turn, className: 'dsh-tc-turn-line' }, [
          h('span', { key: 'l', className: 'dsh-tc-row-label' }, '#' + record.turn + ' · ' + periodLabel(t, record.period) + ' · ' + familyLabel(record.family)),
          h('span', { key: 'r', className: 'dsh-tc-row-value' }, formatTokens(totalTokens(record.tokens)) + ' · ¥' + formatCNY(record.costNano)),
        ]));
        sections.push(h('div', { key: 'turns', className: 'dsh-tc-section' }, [
          h('div', { key: 'title', className: 'dsh-tc-section-title' }, t('turns') + ' · ' + t('turnsRecent', { count: rows.length })),
          h('div', { key: 'body', className: 'dsh-tc-turn-list' }, rows),
        ]));
      }

      if (totals.unpricedAttempts > 0) {
        sections.push(h('div', { key: 'unpriced', className: 'dsh-tc-note' }, t('unpriced', { count: totals.unpricedAttempts })));
      }
      sections.push(h('div', { key: 'note', className: 'dsh-tc-note' }, t('note')));
      sections.push(h('div', { key: 'source', className: 'dsh-tc-note' }, t('source')));
      return h('div', null, sections);
    }

    // -----------------------------------------------------------------------
    // Per-turn detail dialog
    // -----------------------------------------------------------------------
    function TurnCostPanel(props) {
      const t = props.t;
      const data = props.data;
      const record = props.record;
      const rates = rateMap(data);

      const sections = [];
      sections.push(h('div', { key: 'title' }, titleBlock(
        t,
        t('turnPanelTitle'),
        t('totalValue', { cost: formatCNY(record.costNano) }),
      )));
      sections.push(h('div', { key: 'sub', className: 'dsh-tc-sub' }, t('subtitle', { date: data.rateDate })));
      if (record.family === 'mixed') {
        sections.push(h('div', { key: 'mixed', className: 'dsh-tc-note' }, t('mixedHint')));
      }
      sections.push(h('div', { key: 'details' }, detailRows(t, [
        { label: t('detail.period'), value: periodLabel(t, record.period) },
        { label: t('detail.model'), value: familyLabel(record.family) },
        { label: t('detail.calls'), value: String(record.pricedAttempts) },
        { label: t('detail.tokens'), value: t('tokenCount', { count: formatTokens(totalTokens(record.tokens)) }) },
      ])));

      const breakdown = [];
      for (const periodKey of ['peak', 'idle']) {
        const period = record[periodKey];
        if (!period || !period.attempts) continue;
        const rows = formulaRows(t, rates, record.family, periodKey, period.tokens);
        if (rows.length === 0) continue;
        breakdown.push(h('div', { key: periodKey, className: 'dsh-tc-period' }, [
          h('div', { key: 'title', className: 'dsh-tc-period-title' }, periodLabel(t, periodKey) + ' · ' + formatCNY(period.costNano)),
        ].concat(rows)));
      }
      if (breakdown.length > 0) {
        sections.push(h('div', { key: 'breakdown', className: 'dsh-tc-section' }, [
          h('div', { key: 'title', className: 'dsh-tc-section-title' }, t('breakdown')),
          h('div', { key: 'body' }, breakdown),
        ]));
      }
      if (record.unpricedAttempts > 0) {
        sections.push(h('div', { key: 'unpriced', className: 'dsh-tc-note' }, t('unpriced', { count: record.unpricedAttempts })));
      }
      sections.push(h('div', { key: 'note', className: 'dsh-tc-note' }, t('note')));
      sections.push(h('div', { key: 'source', className: 'dsh-tc-note' }, t('source')));
      return h('div', null, sections);
    }

    // -----------------------------------------------------------------------
    // Composer-dock cost pill (bottom statistics row)
    // -----------------------------------------------------------------------
    function SessionCostControl(props) {
      const ctx = props.__ctx;
      const sessionId = props.sessionId;
      const data = useProjection(ctx, sessionId, COST_KEY);
      const { t } = useLocale(ctx);
      const dialog = useStatDialog();
      const bubble = useHoverBubble();
      const ids = useControlIds();
      const panelStyle = useAnchoredPosition(dialog.open, dialog.rootRef, dialog.panelRef);
      const bubbleStyle = useAnchoredPosition(bubble.visible && !dialog.open, dialog.rootRef, bubble.panelRef);
      const visible = !!(data && data.totals && data.totals.pricedAttempts > 0);

      if (!visible) return null;

      const cost = data.totals.costNano;
      const label = '¥' + formatCNY(cost);
      const ariaLabel = t('composerAria', { cost: '¥' + formatCNY(cost) });
      const bubbleContent = [
        h(BubbleLine, { key: 'title', className: 'dsh-tc-bubble-muted' }, t('composerTipTitle')),
        h(BubbleLine, { key: 'total', className: 'dsh-tc-bubble-strong' }, t('composerTipTotal', {
          cost: formatCNY(cost),
          calls: data.totals.pricedAttempts,
        })),
        h(BubbleLine, { key: 'periods' }, t('composerTipPeriods', {
          peak: formatCNY(data.periods.peak.costNano),
          idle: formatCNY(data.periods.idle.costNano),
        })),
        h(BubbleLine, { key: 'hint', className: 'dsh-tc-bubble-muted' }, t('tipOpenHint')),
      ];

      const trigger = h('span', {
        ref: dialog.rootRef,
        className: 'dsh-tc-anchor dsh-tc-composer-anchor',
        'data-composer-stat': 'cny-cost',
        onMouseEnter: bubble.enter,
        onMouseLeave: bubble.leave,
      }, h('button', {
        type: 'button',
        className: 'dsh-tc-pill',
        'aria-haspopup': 'dialog',
        'aria-controls': ids.panel,
        'aria-expanded': dialog.open ? 'true' : 'false',
        'aria-describedby': bubble.visible && !dialog.open ? ids.bubble : undefined,
        'aria-label': ariaLabel,
        onClick: () => dialog.setOpen(!dialog.open),
        onFocus: bubble.enterNow,
        onBlur: bubble.leave,
      }, [
        h(IconCoin, { key: 'icon' }),
        h('span', { key: 'label', className: 'dsh-tc-label' }, label),
      ]));

      const bubbleEl = bubble.visible && !dialog.open
        ? ReactDOM.createPortal(
          h('div', {
            ref: bubble.panelRef,
            id: ids.bubble,
            className: 'dsh-tc-bubble',
            role: 'tooltip',
            style: bubbleStyle || MEASURE_STYLE,
          }, bubbleContent),
          document.body,
        )
        : null;

      const panelEl = dialog.open
        ? ReactDOM.createPortal(
          h('div', {
            ref: dialog.panelRef,
            id: ids.panel,
            className: 'dsh-tc-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('panelTitle'),
            tabIndex: -1,
            style: panelStyle || MEASURE_STYLE,
          }, h(SessionCostPanel, { __ctx: ctx, sessionId, data, t })),
          document.body,
        )
        : null;

      return h(React.Fragment, null, trigger, bubbleEl, panelEl);
    }

    // -----------------------------------------------------------------------
    // Completed-turn cost pill (inside the copy/like/usage/time action row)
    // -----------------------------------------------------------------------
    function TurnCostControlBase(props) {
      const ctx = props.__ctx;
      const messageId = props.messageId;
      const data = useProjection(ctx, props.sessionId, TURN_KEY);
      const { t } = useLocale(ctx);
      const dialog = useStatDialog();
      const bubble = useHoverBubble();
      const ids = useControlIds();
      const chatTurn = props.chatTurn ?? null;
      const panelStyle = useAnchoredPosition(dialog.open, dialog.rootRef, dialog.panelRef);
      const bubbleStyle = useAnchoredPosition(bubble.visible && !dialog.open, dialog.rootRef, bubble.panelRef);
      const record = findTurnRecord(data, messageId, chatTurn);

      if (!record) return null;

      const cumulative = cumulativeCost(data.turns, record.turn);
      const label = '¥' + formatCNY(record.costNano);
      const ariaLabel = t('turnAria', { cost: '¥' + formatCNY(record.costNano) });
      const bubbleContent = [
        h(BubbleLine, { key: 'title', className: 'dsh-tc-bubble-strong' }, t('turnTipTitle', {
          cost: formatCNY(record.costNano),
          total: formatCNY(cumulative),
        })),
        h(BubbleLine, { key: 'tokens' }, t('turnTipTokens', {
          hit: formatTokens(record.tokens.hit),
          miss: formatTokens(record.tokens.miss),
          out: formatTokens(record.tokens.out),
        })),
        h(BubbleLine, { key: 'meta' }, t('turnTipMeta', {
          period: periodLabel(t, record.period),
          family: familyLabel(record.family),
          calls: record.pricedAttempts,
        })),
        h(BubbleLine, { key: 'hint', className: 'dsh-tc-bubble-muted' }, t('turnTipOpenHint')),
      ];

      const trigger = h('span', {
        ref: dialog.rootRef,
        className: 'dsh-tc-anchor dsh-tc-turn-anchor',
        style: { order: 1 },
        onMouseEnter: bubble.enter,
        onMouseLeave: bubble.leave,
      }, h('button', {
        type: 'button',
        className: 'dsh-tc-turn-pill',
        'aria-haspopup': 'dialog',
        'aria-controls': ids.panel,
        'aria-expanded': dialog.open ? 'true' : 'false',
        'aria-describedby': bubble.visible && !dialog.open ? ids.bubble : undefined,
        'aria-label': ariaLabel,
        onClick: () => dialog.setOpen(!dialog.open),
        onFocus: bubble.enterNow,
        onBlur: bubble.leave,
      }, [
        h(IconCoin, { key: 'icon' }),
        h('span', { key: 'label', className: 'dsh-tc-turn-label' }, label),
      ]));

      const bubbleEl = bubble.visible && !dialog.open
        ? ReactDOM.createPortal(
          h('div', {
            ref: bubble.panelRef,
            id: ids.bubble,
            className: 'dsh-tc-bubble',
            role: 'tooltip',
            style: bubbleStyle || MEASURE_STYLE,
          }, bubbleContent),
          document.body,
        )
        : null;

      const panelEl = dialog.open
        ? ReactDOM.createPortal(
          h('div', {
            ref: dialog.panelRef,
            id: ids.panel,
            className: 'dsh-tc-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('turnPanelTitle'),
            tabIndex: -1,
            style: panelStyle || MEASURE_STYLE,
          }, h(TurnCostPanel, { data, record, t })),
          document.body,
        )
        : null;

      return h(React.Fragment, null, trigger, bubbleEl, panelEl);
    }

    /**
     * The optional Chat-snapshot fallback uses a host hook, so it lives in its
     * own component: the wrapper below chooses a variant by mounting one of
     * them, keeping each component's hook order unconditional.
     */
    function TurnCostControlWithChat(props) {
      const chatTurn = useChatTurnForMessage(props.useChat, props.messageId);
      return h(TurnCostControlBase, Object.assign({}, props, { chatTurn }));
    }

    function TurnCostControl(props) {
      return typeof props.useChat === 'function'
        ? h(TurnCostControlWithChat, props)
        : h(TurnCostControlBase, props);
    }

    // -----------------------------------------------------------------------
    // Official pricing watch (browser half)
    //
    // The browser cannot read api-docs.deepseek.com directly: that host sends no
    // CORS header (command line tools are unaffected). A GitHub Actions job
    // mirrors the official markdown into this repository as an extracted static
    // snapshot; raw.githubusercontent.com allows CORS, so this controller polls
    // that file. Everything else — diffing, the confirmation dialog, settings
    // and the update-session launch — runs here in the page. No Host code.
    // -----------------------------------------------------------------------

    //<<<pricing-watch
    const PRICING_WATCH = (() => {
      const RULE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md';
      const OFFICIAL_PAGE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
      const MIRROR_URL = 'https://raw.githubusercontent.com/FeiYuSS/dsh-cny-cost/main/pricing/official-zh.json';
      const REPO_URL = 'https://github.com/FeiYuSS/dsh-cny-cost';
      const BUCKET_KEYS = ['inputCacheHit', 'inputCacheMiss', 'output'];
      const PERIOD_KEYS = ['idle', 'peak'];
      const BUCKET_LABELS = {
        inputCacheHit: '输入·缓存命中',
        inputCacheMiss: '输入·缓存未命中',
        output: '输出',
      };
      const PERIOD_LABELS = { idle: '空闲', peak: '高峰' };

      /** Snapshot of the official pricing the installed plugin was built from. */
      const BUNDLED = { "hash": "262394bb252ee92739803d580b9735026677448127ec3af6c8e0123edbc6d34e", "facts": { "currency": "CNY", "models": { "deepseek-flash": { "prices": { "inputCacheHit": { "idle": 0.02, "peak": 0.04 }, "inputCacheMiss": { "idle": 1, "peak": 2 }, "output": { "idle": 4, "peak": 8 } }, "version": "DeepSeek-V4.1-Flash-1017" }, "deepseek-v4-pro": { "prices": { "inputCacheHit": { "idle": 0.15, "peak": 0.3 }, "inputCacheMiss": { "idle": 4.5, "peak": 9 }, "output": { "idle": 13.5, "peak": 27 } }, "version": "DeepSeek-V4-Pro-0813" } }, "peakRule": "空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。", "aliases": "模型名请使用 `deepseek-flash`。旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用，但对应模型已下线，请求将由 DeepSeek-V4.1-Flash-1017 模型提供服务，并按 Flash 价格计费。", "extras": { "search": { "unit": "每 1,000 次成功请求", "price": 5, "currency": "CNY" }, "fetch": { "unit": "每 1,000 次成功请求", "price": 5, "currency": "CNY" } }, "deduction": "模型调用费用 = token 消耗量 × 模型单价；Search 和 Fetch 按上表中的成功请求次数计费。对应的费用将直接从充值余额或赠送余额中进行扣减。 当充值余额与赠送余额同时存在时，优先扣减赠送余额。 产品价格可能发生变动，DeepSeek 保留修改价格的权利。请您依据实际用量按需充值，定期查看此页面以获知最新价格信息。" } };

      function formatMoney(value, currency) {
        if (typeof value !== 'number') return String(value);
        return String(value) + (currency === 'USD' ? ' USD' : ' 元');
      }

      function diffPricingFacts(previous, next) {
        const changes = [];
        if (!previous || typeof previous !== 'object') return { hasChanges: false, changes };
        const previousModels = previous.models ?? {};
        const nextModels = next.models ?? {};
        const currency = next.currency ?? previous.currency ?? 'CNY';
        for (const model of Object.keys(nextModels).sort()) {
          if (previousModels[model] === undefined) {
            changes.push({ id: 'model.added.' + model, kind: 'model', text: '新增计费模型：' + model });
          }
        }
        for (const model of Object.keys(previousModels).sort()) {
          if (nextModels[model] === undefined) {
            changes.push({ id: 'model.removed.' + model, kind: 'model', text: '移除计费模型：' + model });
          }
        }
        for (const model of Object.keys(nextModels).sort()) {
          const before = previousModels[model];
          const after = nextModels[model];
          if (before === undefined || after === undefined) continue;
          for (const bucket of BUCKET_KEYS) {
            for (const period of PERIOD_KEYS) {
              const from = before.prices?.[bucket]?.[period];
              const to = after.prices?.[bucket]?.[period];
              if (typeof to !== 'number' || typeof from !== 'number' || Math.abs(to - from) < 1e-9) continue;
              changes.push({
                id: 'price.' + model + '.' + bucket + '.' + period,
                kind: 'price',
                model,
                bucket,
                period,
                from,
                to,
                text: model + ' · ' + BUCKET_LABELS[bucket] + ' · ' + PERIOD_LABELS[period] + '：'
                  + formatMoney(from, currency) + ' → ' + formatMoney(to, currency) + ' / 百万 tokens',
              });
            }
          }
          if ((before.version ?? '') !== (after.version ?? '') && after.version) {
            changes.push({ id: 'version.' + model, kind: 'model', text: model + ' 模型版本：' + (before.version ?? '未知') + ' → ' + after.version });
          }
        }
        if ((previous.peakRule ?? '') !== (next.peakRule ?? '') && next.peakRule !== '') {
          changes.push({ id: 'rule.peak', kind: 'rule', from: previous.peakRule ?? '', to: next.peakRule, text: '高峰/空闲时段规则有变化' });
        }
        if ((previous.aliases ?? '') !== (next.aliases ?? '') && next.aliases !== '') {
          changes.push({ id: 'rule.aliases', kind: 'rule', from: previous.aliases ?? '', to: next.aliases, text: '模型名 / 别名说明有变化' });
        }
        for (const key of ['search', 'fetch']) {
          const before = previous.extras?.[key];
          const after = next.extras?.[key];
          if (before === undefined && after === undefined) continue;
          if (before === undefined || after === undefined) {
            changes.push({ id: 'fee.' + key, kind: 'fee', text: (key === 'search' ? 'Search' : 'Fetch') + ' 计费项' + (after === undefined ? '被移除' : '新增') });
            continue;
          }
          if (before.price !== after.price || before.unit !== after.unit) {
            changes.push({
              id: 'fee.' + key,
              kind: 'fee',
              from: before.price,
              to: after.price,
              text: (key === 'search' ? 'Search' : 'Fetch') + ' 价格：' + formatMoney(before.price, before.currency ?? currency)
                + ' → ' + formatMoney(after.price, after.currency ?? currency) + '（' + after.unit + '）',
            });
          }
        }
        if ((previous.deduction ?? '') !== (next.deduction ?? '') && next.deduction !== '') {
          changes.push({ id: 'rule.deduction', kind: 'rule', text: '扣费规则说明有变化' });
        }
        return { hasChanges: changes.length > 0, changes };
      }

      function buildPrompt(options) {
        const input = options ?? {};
        const changes = Array.isArray(input.changes) ? input.changes : [];
        const detectedAt = input.detectedAt ?? new Date().toISOString();
        const fetchedAt = input.fetchedAt ?? '未知';
        const lines = [
          '请更新 dsh-cny-cost 插件的 DeepSeek 官方计费规则快照。',
          '',
          '## 背景',
          '浏览器端的官方定价检查器在 ' + detectedAt + ' 检测到定价快照有变化：',
          '- 官方机器可读来源：' + RULE_URL,
          '- 官方价格页：' + OFFICIAL_PAGE_URL,
          '- 本次检测使用的镜像同步时间：' + fetchedAt,
          '- 镜像地址：' + MIRROR_URL,
          '- 当前插件内置快照：logic.js 的 DEFAULT_RATE_DATE / DEFAULT_FAMILIES / DEFAULT_MODELS / DEFAULT_HOLIDAYS',
          '',
          '## 检测到的变化',
          '',
        ];
        if (changes.length === 0) lines.push('- （未检测到结构化差异，请直接以官方最新页面为准核对）');
        for (const change of changes) {
          lines.push('- ' + change.text);
          if (change.kind === 'rule' && change.from && change.to) {
            lines.push('  - 旧：' + change.from);
            lines.push('  - 新：' + change.to);
          }
        }
        lines.push(
          '',
          '## 任务',
          '1. 打开上面的官方来源，逐项核对：模型列表与别名、缓存命中/未命中/输出单价、高峰/空闲时段规则、法定节假日、Search/Fetch 计费单位，以及任何计费方式变化。',
          '2. 修改插件源码 logic.js：DEFAULT_RATE_DATE、DEFAULT_FAMILIES、DEFAULT_MODELS，节假日有变化时更新 DEFAULT_HOLIDAYS；计费方式变化时同步调整 periodOf/bucketsOf/view 逻辑。',
          '3. 更新 test/logic.test.mjs 的期望值并补充覆盖新规则的用例；运行 npm run check 确认全部测试与 locale/包一致性检查通过。',
          '4. 更新 README.md / README.en.md 的「计价依据」与维护说明、CHANGELOG.md，并刷新 pricing/official-zh.json（node scripts/sync-pricing-mirror.mjs 后按需提交）。',
          '5. 汇报：改了哪些文件、新旧价格对照、测试结果。**在我说「发布」之前不要 git push，也不要发 npm。**',
          '',
          '插件源码通常就在当前工作区的 dsh-cny-cost 目录（目录名可能是 dsh-token-cost）；若工作区没有源码，请先 git clone ' + REPO_URL + '。',
        );
        return lines.join('\n');
      }

      return { RULE_URL, OFFICIAL_PAGE_URL, MIRROR_URL, REPO_URL, BUNDLED, diffPricingFacts, buildPrompt };
    })();
    //>>>pricing-watch

    const WATCH_STORAGE_KEY = 'dsh-cny-cost.pricing-watch.v1';
    const WATCH_DEFAULT_INTERVAL_HOURS = 24;
    const WATCH_MIN_INTERVAL_HOURS = 1;
    const WATCH_MAX_INTERVAL_HOURS = 720;
    const WATCH_STALE_MS = 7 * 24 * 3600 * 1000;

    let PRIMITIVES = null;
    try {
      PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch {
      PRIMITIVES = null;
    }

    function FallbackButton(props) {
      return h('button', {
        type: 'button',
        className: 'dsh-tc-btn dsh-tc-btn-' + (props.variant ?? 'ghost'),
        disabled: props.disabled === true,
        onClick: props.onClick,
      }, props.children);
    }

    function FallbackModal(props) {
      React.useEffect(() => {
        if (!props.open) return undefined;
        const onKey = (event) => { if (event.key === 'Escape' && typeof props.onClose === 'function') props.onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [props.open, props.onClose]);
      if (!props.open) return null;
      return ReactDOM.createPortal(
        h('div', {
          className: 'dsh-tc-modal-backdrop',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget && typeof props.onClose === 'function') props.onClose();
          },
        }, h('div', { className: 'dsh-tc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
          props.title ? h('h3', { className: 'dsh-tc-modal-title' }, props.title) : null,
          props.description ? h('p', { className: 'dsh-tc-modal-sub' }, props.description) : null,
          props.children,
          props.footer ? h('div', { className: 'dsh-tc-modal-footer' }, props.footer) : null)),
        document.body,
      );
    }

    function FallbackSwitch(props) {
      return h('label', { className: 'dsh-tc-switch' },
        h('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: (event) => { if (typeof props.onChange === 'function') props.onChange(event.target.checked); },
        }),
        h('span', null, props.label));
    }

    function FallbackInput(props) {
      const { className, ...rest } = props;
      return h('input', Object.assign({ className: (className ? className + ' ' : '') + 'dsh-tc-input' }, rest));
    }

    function FallbackSegmented(props) {
      const options = Array.isArray(props.options) ? props.options : [];
      return h('span', { className: 'dsh-tc-seg', role: 'group', 'aria-label': props.label },
        options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          'data-active': props.value === option.value ? 'true' : 'false',
          disabled: option.disabled === true,
          onClick: () => { if (typeof props.onChange === 'function') props.onChange(option.value); },
        }, option.label)));
    }

    function FallbackToast(props) {
      React.useEffect(() => {
        if (typeof props.onDone !== 'function') return undefined;
        const timer = setTimeout(() => props.onDone(), props.holdMs ?? 5000);
        return () => clearTimeout(timer);
      }, [props.onDone, props.holdMs]);
      return ReactDOM.createPortal(h('div', { className: 'dsh-tc-toast', role: 'status' }, props.text), document.body);
    }

    const UI = {
      Modal: PRIMITIVES?.Modal ?? FallbackModal,
      Button: PRIMITIVES?.Button ?? FallbackButton,
      Switch: PRIMITIVES?.Switch ?? FallbackSwitch,
      Input: PRIMITIVES?.Input ?? FallbackInput,
      SegmentedControl: PRIMITIVES?.SegmentedControl ?? FallbackSegmented,
      Toast: PRIMITIVES?.Toast ?? FallbackToast,
    };

    function defaultWatchState() {
      return {
        version: 1,
        settings: { enabled: true, intervalHours: WATCH_DEFAULT_INTERVAL_HOURS },
        baseline: { hash: PRICING_WATCH.BUNDLED.hash, facts: PRICING_WATCH.BUNDLED.facts, checkedAt: null, source: 'bundled' },
        pending: null,
        dismissedHash: null,
        lastCheck: null,
        nextCheckAt: null,
        checking: false,
      };
    }

    function loadWatchState() {
      try {
        const raw = window.localStorage.getItem(WATCH_STORAGE_KEY);
        if (!raw) return defaultWatchState();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1) return defaultWatchState();
        const state = Object.assign(defaultWatchState(), parsed);
        state.settings = Object.assign(defaultWatchState().settings, parsed.settings ?? {});
        state.settings.enabled = state.settings.enabled !== false;
        const hours = Math.round(Number(state.settings.intervalHours));
        state.settings.intervalHours = Number.isFinite(hours)
          ? Math.min(WATCH_MAX_INTERVAL_HOURS, Math.max(WATCH_MIN_INTERVAL_HOURS, hours))
          : WATCH_DEFAULT_INTERVAL_HOURS;
        if (!state.baseline || typeof state.baseline.hash !== 'string' || !state.baseline.facts) {
          state.baseline = defaultWatchState().baseline;
        }
        state.checking = false;
        return state;
      } catch {
        return defaultWatchState();
      }
    }

    function createPricingWatchStore(ctx) {
      let state = loadWatchState();
      const listeners = new Set();
      let timer = null;
      let subscribers = 0;
      let inflight = null;

      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            /* one bad subscriber must not stop the others */
          }
        }
      };
      const save = () => {
        try {
          window.localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(state));
        } catch {
          /* private mode: keep the in-memory state only */
        }
      };
      const commit = (patch) => {
        state = Object.assign({}, state, patch);
        save();
        emit();
      };
      const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      const getSnapshot = () => state;

      function computeDelay() {
        const intervalMs = state.settings.intervalHours * 3600 * 1000;
        const last = Date.parse(state.lastCheck?.at ?? '');
        if (!Number.isFinite(last)) return 3000;
        const remaining = last + intervalMs - Date.now();
        return Math.max(5000, remaining);
      }

      function armTimer() {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (subscribers <= 0 || !state.settings.enabled) {
          if (state.nextCheckAt !== null) commit({ nextCheckAt: null });
          return;
        }
        const delay = computeDelay();
        const nextCheckAt = new Date(Date.now() + delay).toISOString();
        if (state.nextCheckAt !== nextCheckAt) commit({ nextCheckAt });
        timer = setTimeout(() => {
          timer = null;
          void check(false);
        }, delay);
      }

      async function fetchRemote() {
        const response = await fetch(PRICING_WATCH.MIRROR_URL + '?ts=' + Date.now(), {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const remote = await response.json();
        if (!remote || remote.version !== 1 || typeof remote.hash !== 'string'
          || !remote.facts || typeof remote.facts !== 'object' || !remote.facts.models) {
          throw new Error('镜像格式不正确');
        }
        return remote;
      }

      async function runCheck(force) {
        commit({ checking: true });
        const at = new Date().toISOString();
        try {
          const remote = await fetchRemote();
          const patch = {
            checking: false,
            lastCheck: { at, ok: true, hash: remote.hash.slice(0, 12), fetchedAt: remote.fetchedAt ?? null },
          };
          if (!state.baseline) {
            patch.baseline = { hash: remote.hash, facts: remote.facts, checkedAt: at, source: 'mirror' };
            patch.pending = null;
          } else if (state.baseline.hash === remote.hash) {
            patch.pending = null;
          } else {
            const diff = PRICING_WATCH.diffPricingFacts(state.baseline.facts, remote.facts);
            const changes = diff.hasChanges
              ? diff.changes
              : [{ id: 'document', kind: 'document', text: '官方定价文档内容有变化（价格表未解析出差异，可能涉及计费方式或说明）' }];
            if (!force && state.dismissedHash === remote.hash) {
              patch.lastCheck = Object.assign(patch.lastCheck, { messageKey: 'watchStatusIgnored' });
            } else {
              patch.pending = {
                detectedAt: at,
                changes,
                remote: { hash: remote.hash, facts: remote.facts, fetchedAt: remote.fetchedAt ?? null },
              };
            }
          }
          commit(patch);
        } catch (error) {
          commit({
            checking: false,
            lastCheck: { at, ok: false, message: String(error?.message ?? error) },
          });
        } finally {
          inflight = null;
          armTimer();
        }
      }

      function check(force) {
        if (inflight !== null) return inflight;
        inflight = runCheck(force);
        return inflight;
      }

      function updateSettings(patch) {
        const next = Object.assign({}, state.settings);
        if (patch.enabled !== undefined) next.enabled = patch.enabled !== false;
        if (patch.intervalHours !== undefined) {
          const hours = Math.round(Number(patch.intervalHours));
          if (!Number.isFinite(hours) || hours < WATCH_MIN_INTERVAL_HOURS || hours > WATCH_MAX_INTERVAL_HOURS) {
            throw new Error('interval out of range');
          }
          next.intervalHours = hours;
        }
        commit({ settings: next });
        armTimer();
        return next;
      }

      function dismiss() {
        if (!state.pending) return;
        commit({ dismissedHash: state.pending.remote.hash, pending: null });
      }

      function resolveWorkspaceId() {
        try {
          const sessions = ctx.get('sessions');
          const snapshot = sessions && sessions.list && typeof sessions.list.getSnapshot === 'function'
            ? sessions.list.getSnapshot()
            : null;
          const values = snapshot && snapshot.byId ? Object.values(snapshot.byId) : [];
          const main = values.find((entry) => ((entry?.retainedBy?.mainView) ?? 0) > 0) ?? null;
          if (main === null) return undefined;
          const workspaces = ctx.get('workspaces');
          const list = workspaces && workspaces.list && typeof workspaces.list.getSnapshot === 'function'
            ? workspaces.list.getSnapshot()
            : null;
          const items = list && Array.isArray(list.items) ? list.items : [];
          const owner = items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(main.id));
          return owner?.workspaceId;
        } catch {
          return undefined;
        }
      }

      async function startUpdateSession(prompt) {
        const uiWorkspace = ctx.get('uiWorkspace');
        if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
          try {
            await uiWorkspace.startSession(resolveWorkspaceId(), {
              prompt,
              whenDraftExists: 'replace',
              clearPreviousDraft: true,
            });
            return { ok: true, mode: 'draft' };
          } catch (error) {
            /* fall through to the clipboard so the prompt is never lost */
          }
        }
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(prompt);
            return { ok: false, mode: 'clipboard' };
          }
        } catch {
          /* clipboard is unavailable */
        }
        return { ok: false, mode: 'failed' };
      }

      async function launchUpdate() {
        let pending = state.pending;
        if (!pending) {
          await check(true);
          pending = state.pending;
        }
        const remote = pending?.remote ?? null;
        const prompt = PRICING_WATCH.buildPrompt({
          changes: pending?.changes ?? [],
          detectedAt: pending?.detectedAt ?? new Date().toISOString(),
          fetchedAt: remote?.fetchedAt ?? state.lastCheck?.fetchedAt ?? null,
        });
        const launched = await startUpdateSession(prompt);
        if (launched.ok) {
          commit({
            baseline: remote
              ? { hash: remote.hash, facts: remote.facts, checkedAt: new Date().toISOString(), source: 'mirror' }
              : state.baseline,
            pending: null,
            dismissedHash: null,
          });
          armTimer();
        }
        return launched;
      }

      function start() {
        subscribers += 1;
        if (subscribers === 1) armTimer();
        return () => {
          subscribers -= 1;
          if (subscribers <= 0) {
            subscribers = 0;
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
          }
        };
      }

      return {
        subscribe,
        getSnapshot,
        start,
        updateSettings,
        checkNow: () => check(true),
        dismiss,
        launchUpdate,
      };
    }

    let pricingWatchStore = null;
    function getPricingWatchStore(ctx) {
      if (pricingWatchStore === null) pricingWatchStore = createPricingWatchStore(ctx);
      return pricingWatchStore;
    }
    function usePricingWatch(ctx) {
      const store = getPricingWatchStore(ctx);
      React.useEffect(() => store.start(), [store]);
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    function watchTabLabel(ctx) {
      try {
        const locale = ctx.get('locale');
        const snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null;
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en';
        return pickLang(active) === 'zh' ? 'Token 计价' : 'Token pricing';
      } catch {
        return 'Token pricing';
      }
    }

    function formatTimestamp(value) {
      if (typeof value !== 'string' || value === '') return '—';
      try {
        return new Date(value).toLocaleString();
      } catch {
        return value;
      }
    }

    function WatchChangeList(props) {
      const changes = Array.isArray(props.changes) ? props.changes : [];
      if (changes.length === 0) return null;
      return h('ul', { className: 'dsh-tc-watch-changes' },
        changes.map((change, index) => h('li', { key: change.id ?? index, className: 'dsh-tc-watch-change' }, change.text)));
    }

    function PricingWatchOverlay(props) {
      const ctx = props.__ctx;
      const { t } = useLocale(ctx);
      const store = getPricingWatchStore(ctx);
      const snapshot = usePricingWatch(ctx);
      const [snoozedHash, setSnoozedHash] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [errorText, setErrorText] = React.useState(null);
      const [toastText, setToastText] = React.useState(null);

      const pending = snapshot.pending;
      const pendingHash = pending?.remote?.hash ?? null;
      const open = Boolean(pending) && snoozedHash !== pendingHash;

      const close = () => { if (pendingHash !== null) setSnoozedHash(pendingHash); };

      const confirm = async () => {
        if (busy) return;
        setBusy(true);
        setErrorText(null);
        try {
          const launched = await store.launchUpdate();
          if (launched.ok) {
            setToastText(t('watchSessionStarted'));
            if (pendingHash !== null) setSnoozedHash(pendingHash);
          } else if (launched.mode === 'clipboard') {
            setToastText(t('watchClipboardCopied'));
            if (pendingHash !== null) setSnoozedHash(pendingHash);
          } else {
            setErrorText(t('watchSessionError'));
          }
        } catch {
          setErrorText(t('watchSessionError'));
        } finally {
          setBusy(false);
        }
      };

      return h(React.Fragment, null,
        h(UI.Modal, {
          open,
          onClose: close,
          title: t('watchModalTitle'),
          closeLabel: t('watchClose'),
          description: t('watchModalSubtitle'),
          footer: h(React.Fragment, null,
            h(UI.Button, { variant: 'outline', onClick: () => { store.dismiss(); setSnoozedHash(null); } }, t('watchIgnore')),
            h(UI.Button, { variant: 'primary', disabled: busy, onClick: () => { void confirm(); } },
              busy ? t('watchStarting') : t('watchStartUpdate'))),
        }, pending ? h(React.Fragment, null,
          h('div', { className: 'dsh-tc-watch-row-label' }, t('watchModalChanges')),
          h(WatchChangeList, { changes: pending.changes }),
          h('p', { className: 'dsh-tc-watch-note' }, t('watchModalNote')),
          errorText !== null ? h('p', { className: 'dsh-tc-watch-note', 'data-kind': 'warn' }, errorText) : null,
        ) : null),
        toastText !== null
          ? h(UI.Toast, {
            key: toastText + ':' + Date.now(),
            text: toastText,
            tone: 'success',
            onDone: () => setToastText(null),
          })
          : null,
      );
    }

    function PricingWatchSettings(props) {
      const ctx = props.__ctx;
      const { t } = useLocale(ctx);
      const store = getPricingWatchStore(ctx);
      const snapshot = usePricingWatch(ctx);
      const [unit, setUnit] = React.useState('hours');
      const [amount, setAmount] = React.useState('');
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [result, setResult] = React.useState(null);

      React.useEffect(() => {
        const hours = snapshot.settings.intervalHours;
        if (hours >= 24 && hours % 24 === 0) {
          setUnit('days');
          setAmount(String(hours / 24));
        } else {
          setUnit('hours');
          setAmount(String(hours));
        }
      }, [snapshot.settings.intervalHours]);

      const saveInterval = () => {
        const value = Number(amount);
        const hours = unit === 'days' ? value * 24 : value;
        if (!Number.isFinite(hours) || hours < WATCH_MIN_INTERVAL_HOURS || hours > WATCH_MAX_INTERVAL_HOURS) {
          setNotice(t('watchIntervalInvalid'));
          return;
        }
        try {
          store.updateSettings({ intervalHours: Math.round(hours) });
          setNotice(t('watchSaved'));
        } catch {
          setNotice(t('watchIntervalInvalid'));
        }
      };

      const checkNow = async () => {
        if (busy !== null) return;
        setBusy('check');
        setResult(null);
        try {
          await store.checkNow();
        } finally {
          setBusy(null);
        }
      };

      const manualUpdate = async () => {
        if (busy !== null) return;
        setBusy('update');
        setResult(null);
        try {
          const launched = await store.launchUpdate();
          setResult(launched.ok ? t('watchSessionStarted') : launched.mode === 'clipboard' ? t('watchClipboardCopied') : t('watchSessionError'));
        } catch {
          setResult(t('watchSessionError'));
        } finally {
          setBusy(null);
        }
      };

      const last = snapshot.lastCheck;
      const lastText = last
        ? formatTimestamp(last.at) + ' · ' + (last.ok
          ? (last.messageKey === 'watchStatusIgnored' ? t('watchStatusIgnored') : t('watchStatusOk'))
          : t('watchStatusError') + '：' + (last.message ?? ''))
        : t('watchNever');
      const nextText = snapshot.settings.enabled
        ? (snapshot.nextCheckAt ? formatTimestamp(snapshot.nextCheckAt) : '—')
        : t('watchDisabled');
      const baselineText = snapshot.baseline
        ? (snapshot.baseline.checkedAt ? formatTimestamp(snapshot.baseline.checkedAt) : t('watchBaselineBundled'))
        : '—';
      const fetchedAt = last?.fetchedAt ?? snapshot.pending?.remote?.fetchedAt ?? null;
      const stale = typeof fetchedAt === 'string' && fetchedAt !== ''
        && Date.now() - Date.parse(fetchedAt) > WATCH_STALE_MS;
      const pendingChanges = snapshot.pending?.changes ?? [];

      return h('div', { className: 'dsh-tc-watch' },
        h('h3', null, t('watchTitle')),
        h('p', { className: 'dsh-tc-watch-desc' }, t('watchDescription')),
        h('div', { className: 'dsh-tc-watch-row' },
          h(UI.Switch, {
            checked: snapshot.settings.enabled,
            label: t('watchAutoCheck'),
            onChange: (next) => store.updateSettings({ enabled: next }),
          })),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchInterval')),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
            h(UI.Input, {
              type: 'number',
              min: 1,
              max: 720,
              className: 'dsh-tc-input',
              value: amount,
              onChange: (event) => setAmount(event.target.value),
            }),
            h(UI.SegmentedControl, {
              value: unit,
              options: [
                { value: 'hours', label: t('watchUnitHours') },
                { value: 'days', label: t('watchUnitDays') },
              ],
              onChange: setUnit,
            }),
            h(UI.Button, { variant: 'outline', onClick: saveInterval }, t('watchSave')))),
        notice !== null ? h('p', { className: 'dsh-tc-watch-note' }, notice) : null,
        h('div', { className: 'dsh-tc-watch-actions' },
          h(UI.Button, { variant: 'outline', disabled: busy !== null, onClick: () => { void checkNow(); } },
            busy === 'check' ? t('watchChecking') : t('watchCheckNow')),
          h(UI.Button, { variant: 'primary', disabled: busy !== null, onClick: () => { void manualUpdate(); } },
            busy === 'update' ? t('watchStarting') : t('watchManualUpdate')),
          h('a', {
            className: 'dsh-tc-watch-link',
            href: PRICING_WATCH.OFFICIAL_PAGE_URL,
            target: '_blank',
            rel: 'noreferrer',
          }, t('watchOpenOfficial'))),
        result !== null ? h('p', { className: 'dsh-tc-watch-note' }, result) : null,
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchLastCheck')),
          h('span', { className: 'dsh-tc-watch-row-value' }, lastText)),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchNextCheck')),
          h('span', { className: 'dsh-tc-watch-row-value' }, nextText)),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchBaseline')),
          h('span', { className: 'dsh-tc-watch-row-value' }, baselineText)),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchMirror')),
          h('span', { className: 'dsh-tc-watch-row-value' }, fetchedAt ? formatTimestamp(fetchedAt) : '—')),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchSource')),
          h('span', { className: 'dsh-tc-watch-row-value' },
            h('a', { className: 'dsh-tc-watch-link', href: PRICING_WATCH.MIRROR_URL, target: '_blank', rel: 'noreferrer' }, PRICING_WATCH.MIRROR_URL))),
        h('div', { className: 'dsh-tc-watch-row' },
          h('span', { className: 'dsh-tc-watch-row-label' }, t('watchPending')),
          h('span', { className: 'dsh-tc-watch-row-value' }, pendingChanges.length > 0 ? String(pendingChanges.length) : t('watchNoPending'))),
        pendingChanges.length > 0
          ? h(WatchChangeList, { changes: pendingChanges })
          : null,
        snapshot.pending ? h('p', { className: 'dsh-tc-watch-note' }, t('watchPendingInSettings')) : null,
        stale ? h('p', { className: 'dsh-tc-watch-note', 'data-kind': 'warn' }, t('watchStale')) : null,
        h('p', { className: 'dsh-tc-watch-note' }, t('watchCorsNote')),
      );
    }

    function withContext(Component, ctx) {
      return function BoundCostComponent(props) {
        return h(Component, Object.assign({}, props, { __ctx: ctx }));
      };
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply(ctx) {
        installStyles();
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'cny-cost', order: 2 },
          withContext(SessionCostControl, ctx),
        ));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
          { name: 'conversation.chat.assistant-actions', id: 'cny-cost', order: 20 },
          withContext(TurnCostControl, ctx),
        ));
        // Global dialog for a detected official pricing change.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'cny-cost-pricing-watch' },
          withContext(PricingWatchOverlay, ctx),
        ));
        // Settings → Plugins → "Token pricing" tab.
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'cny-cost',
            order: 40,
            label: () => watchTabLabel(ctx),
          },
          withContext(PricingWatchSettings, ctx),
        ));
      },
    };
  },
});
