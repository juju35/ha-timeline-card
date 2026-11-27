/**
 * timeline-card / timeline-mini-card: what happened at home today. Home Assistant's logbook over the day (or the last
 * hours), grouped by part of the day, with filter pills by kind (people, openings, devices, alerts), repeats folded and
 * each entry in the colour of its state.
 * https://github.com/juju35/ha-timeline-card
 */

// How often the logbook is read again (ms), and how often "8 minutes ago" and the clock are redrawn.
const TL_REFRESH = 60 * 1000;
// An entry this recent (ms) lights the windows of the house.
const TL_RECENT = 15 * 60 * 1000;

// ── Banner ───────────────────────────────────────────────────────────────────
// The illustrated header's scene: 200 × 80, drawn to the banner's right edge. A house whose clock shows the time, its
// windows lit for a recent entry (and by night), its door open while an opening is open, a red beacon on the roof for
// an active alert; a bush and a garden path. By night (the dark theme), a moon and a darker sky.
const tlScene = ({ night, hour, minute, lit, open, alert }) => {
  const wall = night ? "#2a3a57" : "#ffffff";
  const edge = night ? "#3d5278" : "#b8cbea";
  const pane = lit ? "#ffd86b" : night ? "#1b2840" : "#cfe0fa";
  const ha = ((hour % 12) + minute / 60) * 30;
  const ma = minute * 6;
  const hand = (angle, len, w) =>
    `<line x1="160" y1="22" x2="${(160 + len * Math.sin((angle * Math.PI) / 180)).toFixed(2)}" y2="${(22 - len * Math.cos((angle * Math.PI) / 180)).toFixed(2)}" stroke="${night ? "#e8eefc" : "#2f6fde"}" stroke-width="${w}" stroke-linecap="round"/>`;
  const moon = night ? `<circle cx="134" cy="12" r="6" fill="#f1f4ff"/><circle cx="137" cy="10" r="5" fill="#16243e"/>` : `<circle cx="134" cy="12" r="6" fill="#ffe08a" opacity=".9"/>`;
  const beacon = alert ? `<circle class="beacon" cx="104" cy="16" r="4" fill="#db4437"/><circle cx="104" cy="16" r="8" fill="#db4437" opacity=".25"/>` : "";
  const door = open ? `<path d="M96 80V58h14v22z" fill="${night ? "#0e1626" : "#33506b"}"/><path d="M96 80V58l-6 3v19z" fill="${wall}" stroke="${edge}"/>` : `<rect x="96" y="58" width="14" height="22" rx="1.5" fill="${night ? "#4b638e" : "#9fb7e0"}"/>`;
  return `${moon}
    <path d="M72 80V44l31-22 31 22v36z" fill="${wall}" stroke="${edge}" stroke-width="2"/>
    <rect x="80" y="50" width="11" height="11" rx="1" fill="${pane}"/><rect x="115" y="50" width="11" height="11" rx="1" fill="${pane}"/>
    ${door}${beacon}
    <circle cx="160" cy="22" r="13" fill="${wall}" stroke="${night ? "#e8eefc" : "#2f6fde"}" stroke-width="2"/>
    ${hand(ha, 6, 2.2)}${hand(ma, 9, 1.6)}<circle cx="160" cy="22" r="1.6" fill="${night ? "#e8eefc" : "#2f6fde"}"/>
    <circle cx="150" cy="72" r="9" fill="${night ? "#2f5a3e" : "#9fd3b4"}"/><circle cx="162" cy="74" r="7" fill="${night ? "#356546" : "#b5e0c6"}"/>
    <circle cx="58" cy="74" r="6" fill="${night ? "#2f5a3e" : "#9fd3b4"}"/>`;
};

// The status pill's place, decided by measurement after each render and each new width (the same rule on every
// card): on the title row, right after the title, only when the whole title and the pill's whole label fit there;
// otherwise on its own line under the subtitle (clamped to one line). When the label is still cut there, or the text
// block leaves the banner or runs over its ground strip, the pill keeps its dot alone, on the title row (its label
// stays in title and aria-label). A card of 200 px or less shows the dot alone anyway (CSS), beside the title.
const tlPlacePill = (head, row, ground) => {
  if (!head) return;
  head.removeAttribute("data-wrap");
  head.removeAttribute("data-dot");
  const pill = row.querySelector(":scope > .bpill");
  const text = pill?.querySelector(".bpt");
  if (!text?.getBoundingClientRect || text.getBoundingClientRect().width <= 1) return;
  const name = row.querySelector(".title");
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const title = name ? (name.scrollWidth > name.clientWidth ? name.scrollWidth : name.getBoundingClientRect().width) + gap : 0;
  if (title + pill.getBoundingClientRect().width <= row.getBoundingClientRect().width + 0.5) return;
  head.setAttribute("data-wrap", "");
  const box = row.parentElement.getBoundingClientRect();
  const frame = head.getBoundingClientRect();
  const out = ground && (box.bottom > ground.getBoundingClientRect().top + 0.5 || box.top < frame.top - 0.5);
  if (text.scrollWidth > text.clientWidth + 0.5 || out) {
    head.removeAttribute("data-wrap");
    head.setAttribute("data-dot", "");
  }
};

// ── Card ─────────────────────────────────────────────────────────────────────
class TimelineCard extends RcCard {
  static tag = "timeline-card";
  static i18n = TL_I18N;
  static defaults = { illustration: true, illustration_theme: "auto", show_subtitle: true, show_filters: true, fold: true, max_events: 12 };

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 6;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._timer ??= setInterval(() => {
      this._sig = null;
      this._render();
    }, TL_REFRESH);
    // The logbook is read once the card is on screen (a card further down the dashboard asks for nothing until then).
    if (typeof IntersectionObserver === "function" && !this._seen) {
      this._io ??= new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this._seen = true;
        this._io.disconnect();
        this._io = null;
        this._render();
      });
      this._io.observe(this);
    }
    // A new width: the status pill is fitted again (in the next frame, and only for a new width).
    if (typeof ResizeObserver !== "function") return;
    this._resize ??= new ResizeObserver((entries) => {
      const w = Math.round(entries.at(-1).contentRect.width);
      if (w === this._fitWidth) return;
      this._fitWidth = w;
      cancelAnimationFrame(this._fitFrame);
      this._fitFrame = requestAnimationFrame(() => this._fitPill());
    });
    this._resize.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    clearInterval(this._timer);
    this._timer = undefined;
    this._io?.disconnect();
    this._io = null;
    this._resize?.disconnect();
    this._fitWidth = undefined;
    if (this._fitFrame) cancelAnimationFrame(this._fitFrame);
    // Left (another view): back to the first events and every category.
    this._all = false;
    this._filter = "all";
  }

  _visible() {
    return this._seen || typeof IntersectionObserver !== "function";
  }

  // The start of the window: local midnight, or `hours_to_show` hours ago.
  _start(now) {
    const h = Number(this._config.hours_to_show);
    if (h > 0) return now - Math.min(h, 168) * 3600000;
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // The logbook over the window, through the WebSocket (`logbook/get_events`), else the REST API.
  async _fetch(key, start) {
    const h = this._hass;
    if (this._busy) return;
    this._busy = true;
    const ids = this._config.entities || [];
    const from = new Date(start).toISOString();
    const to = new Date(Date.now()).toISOString();
    let list = null;
    try {
      if (h.callWS) list = await h.callWS({ type: "logbook/get_events", start_time: from, end_time: to, ...(ids.length ? { entity_ids: ids } : {}) });
      else list = await h.callApi("GET", `logbook/${encodeURIComponent(from)}?end_time=${encodeURIComponent(to)}${ids.length ? `&entity=${ids.join(",")}` : ""}`);
    } catch {
      list = null;
    } finally {
      this._busy = false;
    }
    this._log = { key, at: Date.now(), list: Array.isArray(list) ? list : null };
    this._sig = null;
    this._render();
  }

  // Every entry of the window, newest first, with its category, tone, icon, text and part of the day.
  _collect() {
    const h = this._hass;
    const c = this._config;
    const now = Date.now();
    const start = this._start(now);
    const key = JSON.stringify([c.entities || [], c.hours_to_show || 0, start]);
    const log = this._log;
    const stale = !log || log.key !== key || now - log.at >= TL_REFRESH;
    if (this._visible() && stale && (h.callWS || h.callApi)) this._fetch(key, start);
    const base = { name: c.title || (Number(c.hours_to_show) > 0 ? this._t("title_hours", { n: Number(c.hours_to_show) }) : this._t("title")), now, items: [], counts: {}, alerts: 0 };
    if (!log || log.key !== key) return { ...base, state: "loading" };
    if (!log.list) return { ...base, state: "error" };
    const only = c.entities?.length ? new Set(c.entities) : null;
    const items = [];
    for (const raw of log.list) {
      const e = tlEntry(raw);
      if (!e || e.t < start) continue;
      if (only && !only.has(e.id)) continue;
      if ((c.exclude || []).some((p) => tlMatch(e.id, p))) continue;
      const so = h.states?.[e.id];
      const cat = tlCategory(e.id, so);
      const formatted = e.message || (so && h.formatEntityState ? h.formatEntityState(so, e.state) : e.state);
      items.push({
        id: e.id,
        t: e.t,
        cat,
        tone: tlTone(cat, e.state),
        icon: tlIcon(e.id, so, e.state),
        title: e.name || so?.attributes?.friendly_name || e.id,
        line: formatted,
        part: tlPart(e.t),
      });
    }
    items.sort((a, b) => b.t - a.t);
    const counts = Object.fromEntries(TL_CATS.map((k) => [k, items.filter((i) => i.cat === k).length]));
    // The alerts still active: an alert entity whose current state is an alert.
    const alerts = new Set(items.filter((i) => i.cat === "alerts" && tlTone("alerts", h.states?.[i.id]?.state) === "alert").map((i) => i.id)).size;
    const open = items.some((i) => i.cat === "openings" && tlTone("openings", h.states?.[i.id]?.state) === "open");
    return { ...base, state: items.length ? "ok" : "empty", items, counts, alerts, open };
  }

  _night() {
    const theme = this._config.illustration_theme;
    if (theme === "night" || theme === "day") return theme === "night";
    return this._dark();
  }

  _dark() {
    return !!this._hass.themes?.darkMode;
  }

  _time(t) {
    try {
      return new Intl.DateTimeFormat(this._lang(), { hour: "numeric", minute: "2-digit" }).format(new Date(t));
    } catch {
      return new Date(t).toTimeString().slice(0, 5);
    }
  }

  _date(t) {
    try {
      return new Intl.DateTimeFormat(this._lang(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(t));
    } catch {
      return new Date(t).toDateString();
    }
  }

  // "8 minutes ago", "now".
  _ago(t, now) {
    const min = Math.round((now - t) / 60000);
    try {
      const f = new Intl.RelativeTimeFormat(this._lang(), { numeric: "auto" });
      return min < 60 ? f.format(-Math.max(0, min), "minute") : f.format(-Math.round(min / 60), "hour");
    } catch {
      return `${min} min`;
    }
  }

  // The status pill: the active alerts in red, else how many entries.
  _status(m) {
    if (m.alerts) return { text: this._tn("alerts", m.alerts), level: "alert" };
    if (m.state === "loading") return { text: this._t("loading"), level: "idle" };
    if (m.state === "error") return { text: this._t("error"), level: "idle" };
    return { text: this._tn("events", m.items.length), level: m.items.length ? "open" : "idle" };
  }

  // The illustrated header: the badge, the title, `sub` and the pill on the left, the house at the right, a 10 px
  // garden strip edge to edge.
  _banner(m, sub, status) {
    const c = this._config;
    const nav = c.navigation_path;
    const night = this._night();
    const d = new Date(m.now);
    const scene = tlScene({ night, hour: d.getHours(), minute: d.getMinutes(), lit: night || (m.items[0] && m.now - m.items[0].t < TL_RECENT), open: m.open, alert: m.alerts > 0 });
    const chip = `<span class="bpill" title="${rcEsc(status.text)}" aria-label="${rcEsc(status.text)}"><span class="bdot"></span><span class="bpt">${rcEsc(status.text)}</span></span>`;
    return `
      <div class="banner${night ? " night" : ""}">
        <div class="head${nav ? " nav" : ""}"${nav ? ' role="link" tabindex="0"' : ""}>
          <div class="badge"><ha-icon icon="mdi:timeline-clock-outline"></ha-icon></div>
          <div class="tt"><div class="trow"><div class="title">${rcEsc(m.name)}</div>${chip}</div>${sub}</div>
        </div>
        <svg class="room" viewBox="0 0 200 80" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">${scene}</svg>
        <div class="ground"></div>
      </div>`;
  }

  // The classic header (`illustration: false`): badge, title with the pill, subtitle.
  _plainHead(m, sub, status) {
    const nav = this._config.navigation_path;
    return `<div class="head${nav ? " nav" : ""}"${nav ? ' role="link" tabindex="0"' : ""}>
      <div class="badge"><ha-icon icon="mdi:timeline-clock-outline"></ha-icon></div>
      <div class="tt"><div class="trow"><div class="title">${rcEsc(m.name)}</div><span class="bpill" title="${rcEsc(status.text)}" aria-label="${rcEsc(status.text)}"><span class="bdot"></span><span class="bpt">${rcEsc(status.text)}</span></span></div>${sub}</div>
    </div>`;
  }

  // The status pill's place, on the banner and on the classic header (see tlPlacePill).
  _fitPill() {
    for (const row of this.shadowRoot?.querySelectorAll?.(".trow") || []) {
      const banner = row.closest(".banner");
      tlPlacePill(banner || row.closest(".head"), row, banner?.querySelector(".ground"));
    }
  }

  // The filter pills: every category with entries, after "All"; a lone category needs no filter.
  _filters(m) {
    const cats = TL_CATS.filter((k) => m.counts[k]);
    if (this._config.show_filters === false || cats.length < 2) return "";
    const f = this._cat(m);
    const pill = (k, n) =>
      `<button class="fp${f === k ? " on" : ""}${k === "alerts" ? " fa" : ""}" data-f="${k}" aria-pressed="${f === k}">${rcEsc(this._t(`f_${k}`))}${n != null ? `<span class="fn">${n}</span>` : ""}</button>`;
    return `<div class="filters">${pill("all")}${cats.map((k) => pill(k, m.counts[k])).join("")}</div>`;
  }

  // The category filtered on: "all", or one that still has entries (with no filter pills, always "all").
  _cat(m) {
    const f = this._filter;
    return this._config.show_filters !== false && f && m.counts[f] ? f : "all";
  }

  _row(e, last) {
    return `<button class="ev t-${e.tone}"${e.id ? ` data-id="${rcEsc(e.id)}"` : ""}>
      <span class="et">${rcEsc(this._time(e.t))}</span>
      <span class="ed"><span class="ei"><ha-icon icon="${rcEsc(e.icon)}"></ha-icon></span>${last ? "" : '<span class="el"></span>'}</span>
      <span class="ex"><span class="en">${rcEsc(e.title)}${e.count > 1 ? `<span class="ec">×${e.count}</span>` : ""}</span><span class="es">${rcEsc(e.line)}</span></span>
    </button>`;
  }

  // The entries shown (filtered, folded, the first `max_events` unless "Show all"), grouped by part of the day.
  _list(m) {
    const f = this._cat(m);
    let rows = m.items.filter((i) => f === "all" || i.cat === f);
    if (this._config.fold !== false) rows = tlFold(rows);
    const max = Math.max(1, Math.round(Number(this._config.max_events) || 12));
    const cut = !this._all && rows.length > max;
    const shown = cut ? rows.slice(0, max) : rows;
    const groups = [];
    for (const r of shown) {
      if (groups.at(-1)?.part !== r.part) groups.push({ part: r.part, rows: [] });
      groups.at(-1).rows.push(r);
    }
    const body = groups
      .map((g) => `<div class="gh">${rcEsc(this._t(`g_${g.part}`))}</div><div class="gr">${g.rows.map((r, i) => this._row(r, i === g.rows.length - 1)).join("")}</div>`)
      .join("");
    const more = rows.length > max ? `<button class="more">${rcEsc(this._all ? this._t("show_less") : this._t("show_all", { n: rows.length }))}</button>` : "";
    return `<div class="list">${body}${more}</div>`;
  }

  _sub() {
    if (this._config.show_subtitle === false) return "";
    return `<div class="subt">${rcEsc(this._date(Date.now()))}</div>`;
  }

  _draw(m) {
    const c = this._config;
    const dark = this._dark();
    const night = this._night();
    const minute = Math.floor(m.now / 60000);
    if (!this._changed([m.state, m.items, m.alerts, m.open, dark, night, minute, this._filter, this._all])) return;
    const status = this._status(m);
    const head = c.illustration !== false ? this._banner(m, this._sub(), status) : this._plainHead(m, this._sub(), status);
    const body =
      m.state === "ok"
        ? `${this._filters(m)}${this._list(m)}`
        : `<div class="box none">${rcEsc(this._t(m.state === "loading" ? "loading" : m.state === "error" ? "error" : "nothing"))}</div>`;
    this._paint(status.level, head + body, "", `${dark ? " dk" : ""}`);
    this._fitPill();
  }

  _bindAfter(root) {
    for (const b of root.querySelectorAll(".ev[data-id]") || []) b.addEventListener("click", () => rcMoreInfo(this, b.dataset.id));
    for (const b of root.querySelectorAll(".fp") || [])
      b.addEventListener("click", () => {
        this._filter = b.dataset.f;
        this._all = false;
        this._render();
      });
    root.querySelector(".more")?.addEventListener("click", () => {
      this._all = !this._all;
      this._render();
    });
  }

  static styles = `
    ha-card { --c: var(--rc-info); }
    ha-card.lvl-alert { --c: var(--rc-alert); } ha-card.lvl-open { --c: var(--rc-info); } ha-card.lvl-idle { --c: var(--rc-idle); }
    .t-ok { --t: var(--rc-ok); } .t-warm { --t: var(--rc-warn); } .t-open { --t: var(--rc-info); } .t-alert { --t: var(--rc-alert); }
    .t-idle { --t: var(--rc-idle); } .t-media { --t: #7c4ddb; }
    .tt { flex: 1 1 0; min-width: 5ch; display: flex; flex-direction: column; }
    .tt .title { flex: none; }
    .subt { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .subt::first-letter { text-transform: uppercase; }
    :host([hide-title]) .head .tt { visibility: hidden; }
    .box { margin-top: 10px; border-radius: 12px; padding: 10px 12px; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
    .none { font-size: 13px; color: var(--secondary-text-color); }
    .filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .fp { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 30px;
          padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 500; color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(127,127,127,.25)); }
    .fp:hover { background: color-mix(in srgb, var(--rc-info) 8%, transparent); }
    .fp.on { color: color-mix(in srgb, var(--rc-info) 60%, var(--primary-text-color, #212121)); border-color: color-mix(in srgb, var(--rc-info) 45%, transparent);
             background: color-mix(in srgb, var(--rc-info) 12%, transparent); }
    .fp.fa.on { color: color-mix(in srgb, var(--rc-alert) 60%, var(--primary-text-color, #212121)); border-color: color-mix(in srgb, var(--rc-alert) 45%, transparent);
                background: color-mix(in srgb, var(--rc-alert) 12%, transparent); }
    .fp:focus-visible, .ev:focus-visible, .more:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
    .fn { font-size: 11px; color: var(--secondary-text-color); }
    .list { margin-top: 6px; }
    .gh { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color); margin: 12px 0 4px; }
    .ev { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 12px; cursor: default; border-radius: 10px; }
    .ev[data-id] { cursor: pointer; }
    .ev[data-id]:hover .ex { background: color-mix(in srgb, var(--t) 6%, transparent); }
    .et { flex: none; width: 4.9em; white-space: nowrap; text-align: right; padding-top: 9px; font-size: 12.5px; font-weight: 600; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    .ed { flex: none; display: flex; flex-direction: column; align-items: center; }
    .ei { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--t);
          background: color-mix(in srgb, var(--t) 16%, transparent); }
    .ei ha-icon { --mdc-icon-size: 17px; }
    .el { flex: 1; width: 2px; min-height: 8px; background: var(--divider-color, rgba(127,127,127,.2)); }
    .ex { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 6px 8px 10px; margin-left: -6px; border-radius: 8px; }
    .en { font-size: 13.5px; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ec { margin-left: 6px; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 999px; color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(127,127,127,.12)); }
    .es { font-size: 12px; font-weight: 500; color: color-mix(in srgb, var(--t) 60%, var(--primary-text-color, #212121)); overflow-wrap: anywhere; }
    .t-idle .es { color: var(--secondary-text-color); }
    ha-card.dk .es { color: color-mix(in srgb, var(--t) 60%, #fff); }
    ha-card.dk .t-idle .es { color: var(--secondary-text-color); }
    .more { all: unset; box-sizing: border-box; cursor: pointer; display: block; margin: 8px 0 2px auto; min-height: 32px; padding: 6px 14px;
            border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--primary-text-color);
            border: 1px solid var(--divider-color, rgba(127,127,127,.25)); }
    .more:hover { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
    @container (max-width: 300px) { .et { width: 4.6em; font-size: 11px; } .ev { gap: 8px; } }
    /* Illustrated header (banner): 90 px, edge to edge, the title on a pale sky, the house and its clock at the right, a
       10 px garden strip at the bottom. The badge's icon is in the status colour, by day and night. */
    .banner { position: relative; display: flex; height: 90px; margin: -12px -12px 0; overflow: hidden;
              background: linear-gradient(180deg, #eef4fd 0%, #dce8f8 100%);
              --bt: #0d2a45; --bs: #3b5b78; --ic: color-mix(in srgb, var(--c) 85%, #10283f); --sw: min(200px, 56%); }
    .banner.night { background: linear-gradient(180deg, #121d33 0%, #1c2c4a 100%); --bt: #fff; --bs: rgba(255,255,255,.78); --ic: color-mix(in srgb, var(--c) 72%, #fff); }
    .banner .head { position: relative; z-index: 1; flex: 1; min-width: 0; height: 80px; box-sizing: border-box;
                    padding: 0 calc(var(--sw) + 4px) 0 14px; flex-wrap: nowrap; }
    .banner .head::after { content: none; }
    .banner .badge { position: relative; color: var(--ic); background: rgba(255,255,255,.7); box-shadow: inset 0 0 0 1px rgba(13,42,69,.12); }
    .banner.night .badge { background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
    .banner .title { color: var(--bt); }
    .banner .subt { color: var(--bs); font-size: 13px; }
    .banner .room { position: absolute; right: 0; bottom: 10px; width: var(--sw); height: calc(80px * var(--sk, 1)); }
    .banner .ground { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: repeating-linear-gradient(90deg, #9cc58a 0 22px, #aacf98 22px 44px); }
    .banner.night .ground { background: repeating-linear-gradient(90deg, #2f4a30 0 22px, #375637 22px 44px); }
    /* The mini card's expand / collapse button: 24 px, frosted, 5 px from the banner's top right corner. */
    .banner .zoom { position: absolute; z-index: 2; top: 5px; right: 5px; width: 24px; height: 24px; margin: 0; color: #33506b;
                    background: rgba(255,255,255,.55); box-shadow: inset 0 0 0 1px rgba(255,255,255,.7); backdrop-filter: blur(4px); }
    .banner.night .zoom { color: #fff; background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }
    .banner .zoom:hover { background: rgba(255,255,255,.75); color: #33506b; }
    .banner.night .zoom:hover { background: rgba(255,255,255,.22); color: #fff; }
    .banner .tt { min-width: 0; flex: 1 1 auto; }
    /* Status pill right after the title (see tlPlacePill). */
    .trow { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .trow > .title { flex: 0 1 auto; min-width: 0; }
    .trow > .bpill { flex: none; max-width: none; }
    :host([hide-title]) .trow .title { visibility: hidden; }
    .head:has(.trow) { flex-wrap: nowrap; }
    .head:has(.trow)::after { content: none; }
    .bpill { display: inline-flex; align-items: center; gap: 4px; min-width: 0; box-sizing: border-box; overflow: hidden;
             white-space: nowrap; padding: 1px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; line-height: 16px;
             background: color-mix(in srgb, var(--c) 18%, rgba(255,255,255,.78)); color: color-mix(in srgb, var(--c) 45%, #0d2a45); }
    .banner.night .bpill { background: color-mix(in srgb, var(--c) 30%, rgba(8,18,38,.55)); color: color-mix(in srgb, var(--c) 35%, #ffffff); }
    ha-card.dk > .head .bpill { color: color-mix(in srgb, var(--c) 45%, #fff); background: color-mix(in srgb, var(--c) 22%, transparent); }
    .bdot { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex: none; }
    .bpt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    [data-wrap] .trow { display: contents; }
    [data-wrap] .trow > .bpill { order: 9; align-self: flex-start; max-width: 100%; margin-top: 3px; }
    .banner[data-wrap] .trow > .bpill { max-width: calc(100cqw - 80px); }
    [data-wrap] .subt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    [data-dot] .bpill { padding: 0; background: none; }
    [data-dot] .bpt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @container (max-width: 200px) {
      .bpill { padding: 0; background: none; }
      .bpt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    }
    /* The mini card: the banner alone. */
    ha-card.bn { padding: 0; }
    ha-card.bn > .banner { margin: 0; --sw: min(150px, 40%); --sk: .9; }
    ha-card.bn > .banner .room, .banner:has(.zoom) .room { right: 28px; }
    /* Narrower cards: the house is drawn smaller (75 %, 62 %, then 50 % of its height, its left part cropped). */
    @container (max-width: 420px) { .banner { --sw: 150px; --sk: .75; } }
    @container (max-width: 340px) { .banner { --sw: 112px; --sk: .62; } ha-card.bn > .banner .room { display: none; } ha-card.bn > .banner .head { padding-right: 34px; } }
    @container (max-width: 260px) { .banner { --sw: 70px; --sk: .5; } }
    /* The mini card's second line: the last entry and how long ago, plain text cut with an ellipsis. */
    .banner .evt { all: unset; display: block; min-width: 0; color: var(--bs); font-size: 13px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .banner .evt[data-id] { cursor: pointer; }
    .banner .evt:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
    .lvl-alert .banner .beacon { animation: rc-pulse 1.6s ease-in-out infinite; }
  `;
}

// ── Editor ───────────────────────────────────────────────────────────────────
const tlSchema = (booleans) => (lang) => [
  { name: "title", selector: { text: {} } },
  { name: "navigation_path", selector: { navigation: {} } },
  { name: "entities", selector: { entity: { multiple: true } } },
  { name: "exclude", selector: { entity: { multiple: true } } },
  { name: "hours_to_show", selector: { number: { min: 1, max: 168, step: 1, mode: "box" } } },
  { name: "max_events", selector: { number: { min: 1, max: 100, step: 1, mode: "box" } } },
  ...rcBooleans(...booleans),
  {
    name: "illustration_theme",
    selector: { select: { mode: "dropdown", options: ["auto", "day", "night"].map((value) => ({ value, label: rcT(TL_I18N, lang, `ed_theme_${value}`) })) } },
  },
  ...rcAdvanced(TL_I18N, lang, "language"),
];

const TL_HELPERS = ["title", "entities", "exclude", "hours_to_show", "max_events", "fold", "zoom", "language"];

const TimelineCardEditor = rcEditor({
  card: TimelineCard,
  helpers: TL_HELPERS,
  schema: tlSchema(["show_title", "show_subtitle", "show_filters", "fold", "illustration"]),
});

rcRegister(TimelineCard, TimelineCardEditor, "Timeline Card", "What happened at home today: the logbook grouped by part of the day, with filter pills and repeats folded");

// ── Mini card ────────────────────────────────────────────────────────────────
// The banner alone: the title with how many entries (or the active alerts), then the last entry and how long ago; the
// zoom button opens the full card in place.
class TimelineMiniCard extends rcMini(TimelineCard, "timeline-mini-card", "") {
  getCardSize() {
    return this._zoomed ? super.getCardSize() : 1;
  }

  _drawMini(m) {
    const night = this._night();
    const dark = this._dark();
    const minute = Math.floor(m.now / 60000);
    if (!this._changed(["mini", m.state, m.items[0], m.items.length, m.alerts, m.open, night, dark, minute])) return;
    const e = m.items[0];
    const status = this._status(m);
    const text = e ? `${e.title} · ${e.line} · ${this._ago(e.t, m.now)}` : this._t(m.state === "ok" || m.state === "empty" ? "nothing" : m.state === "error" ? "error" : "loading");
    const line = `<button class="subt evt"${e?.id ? ` data-id="${rcEsc(e.id)}"` : ""} title="${rcEsc(text)}">${rcEsc(text)}</button>`;
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${RC_BASE_STYLES}${this.constructor.styles}</style>
      <ha-card class="lvl-${status.level} bn${dark ? " dk" : ""}">${this._banner(m, line, status)}</ha-card>`;
    const root = this.shadowRoot;
    if (c.navigation_path) rcBindNav(root.querySelector(".head"), c.navigation_path);
    for (const el of root.querySelectorAll(".evt[data-id]")) el.addEventListener("click", () => rcMoreInfo(this, el.dataset.id));
    this._fitPill();
  }
}

const TimelineMiniCardEditor = rcEditor({
  card: TimelineMiniCard,
  helpers: TL_HELPERS,
  schema: tlSchema(["show_title", "show_subtitle", "show_filters", "fold", "illustration", "zoom"]),
});

rcRegister(TimelineMiniCard, TimelineMiniCardEditor, "Timeline Mini Card", "The last thing that happened at home and how many today, with a zoom to the full timeline");
