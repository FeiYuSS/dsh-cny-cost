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
      },
    };
  },
});
