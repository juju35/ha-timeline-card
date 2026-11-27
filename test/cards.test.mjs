import assert from "node:assert/strict";
import { test } from "node:test";
import { at, LOG, makeHass, NOW, STATES } from "./hass.mjs";
import { fakeNode, load } from "./load.mjs";

const tl = load({ now: NOW });
const { cards } = tl;
const json = (v) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((r) => setTimeout(r, 0));

// A card whose shadow root answers every selector with nodes recording their click listeners; the logbook read
// (callWS) before the test looks at it.
const make = async (tag, config = {}, hass = makeHass()) => {
  const card = new cards[tag]();
  card.attachShadow();
  const nodes = {};
  card.shadowRoot.querySelector = (s) => (nodes[s] ||= fakeNode());
  card.setConfig({ type: `custom:${tag}`, ...config });
  card.hass = hass;
  await settle();
  await settle();
  return card;
};
const redraw = (card) => {
  card._sig = null;
  card._render();
  return card.shadowRoot.innerHTML;
};

test("both cards are registered, with their editors and a picker entry", () => {
  for (const tag of ["timeline-card", "timeline-mini-card"]) {
    assert.ok(tl.customElements.get(tag), tag);
    assert.ok(tl.customElements.get(`${tag}-editor`), `${tag}-editor`);
  }
  assert.deepEqual(json(tl.window.customCards.map((c) => c.type)), ["timeline-card", "timeline-mini-card"]);
  assert.deepEqual(json(cards["timeline-card"].getStubConfig()), {});
});

test("categories: people, openings, alerts, else devices", () => {
  const cat = (id) => tl.tlCategory(id, STATES[id]);
  assert.equal(cat("person.sam"), "people");
  assert.equal(cat("binary_sensor.front_door"), "openings");
  assert.equal(tl.tlCategory("lock.front", undefined), "openings");
  assert.equal(cat("binary_sensor.kitchen_leak"), "alerts");
  assert.equal(cat("alarm_control_panel.home"), "alerts");
  assert.equal(cat("light.living_room"), "devices");
  assert.equal(tl.tlCategory("", undefined), "devices", "an entry with no entity");
});

test("tones follow the charter: home green, open blue, alert red, at work amber, media violet, at rest grey", () => {
  assert.equal(tl.tlTone("people", "home"), "ok");
  assert.equal(tl.tlTone("people", "not_home"), "idle");
  assert.equal(tl.tlTone("people", "work"), "open", "another zone");
  assert.equal(tl.tlTone("openings", "on"), "open");
  assert.equal(tl.tlTone("openings", "off"), "idle");
  assert.equal(tl.tlTone("openings", "jammed"), "alert");
  assert.equal(tl.tlTone("alerts", "on"), "alert");
  assert.equal(tl.tlTone("alerts", "triggered"), "alert");
  assert.equal(tl.tlTone("alerts", "armed_away"), "warm");
  assert.equal(tl.tlTone("alerts", "disarmed"), "ok");
  assert.equal(tl.tlTone("devices", "cleaning"), "warm");
  assert.equal(tl.tlTone("devices", "docked"), "idle");
  assert.equal(tl.tlTone("devices", "playing"), "media");
  assert.equal(tl.tlTone("devices", ""), "idle", "no state");
});

test("icons: the entity's own, else its device class (open or closed), else its domain", () => {
  assert.equal(tl.tlIcon("binary_sensor.front_door", STATES["binary_sensor.front_door"], "on"), "mdi:door-open");
  assert.equal(tl.tlIcon("binary_sensor.front_door", STATES["binary_sensor.front_door"], "off"), "mdi:door-closed");
  assert.equal(tl.tlIcon("person.sam", STATES["person.sam"], "home"), "mdi:account");
  assert.equal(tl.tlIcon("light.x", { attributes: { icon: "mdi:lamp" } }, "on"), "mdi:lamp");
  assert.equal(tl.tlIcon("", undefined, ""), "mdi:home-assistant");
});

test("entries from the WebSocket (seconds) and the REST API (ISO dates); parts of the day", () => {
  assert.equal(tl.tlEntry({ when: at(8, 12), entity_id: "a.b", state: "on" }).t, at(8, 12) * 1000);
  assert.equal(tl.tlEntry({ when: new Date(at(8, 12) * 1000).toISOString(), entity_id: "a.b" }).t, at(8, 12) * 1000);
  assert.equal(tl.tlEntry({ when: "nonsense" }), null);
  assert.deepEqual([3, 9, 15, 21].map((h) => tl.tlPart(new Date(2026, 10, 27, h).getTime())), ["night", "morning", "afternoon", "evening"]);
});

test("exclude patterns and folded repeats", () => {
  assert.ok(tl.tlMatch("sensor.outdoor_temperature", "sensor.*"));
  assert.ok(tl.tlMatch("sensor.phone_battery", "*_battery"));
  assert.ok(!tl.tlMatch("light.sensor", "sensor.*"));
  assert.ok(tl.tlMatch("light.a", "light.a"));
  const rows = tl.tlFold([
    { id: "a", part: "afternoon" },
    { id: "a", part: "afternoon" },
    { id: "b", part: "afternoon" },
    { id: "a", part: "afternoon" },
    { id: "a", part: "morning" },
  ]);
  assert.deepEqual(json(rows.map((r) => [r.id, r.count])), [["a", 2], ["b", 1], ["a", 1], ["a", 1]]);
});

test("full card: the logbook read over today, grouped by part of the day, newest first", async () => {
  const hass = makeHass();
  const card = await make("timeline-card", {}, hass);
  assert.equal(hass.calls.length, 1);
  const msg = hass.calls[0];
  assert.equal(msg.type, "logbook/get_events");
  assert.equal(Date.parse(msg.start_time), new Date(2026, 10, 27).getTime(), "since local midnight");
  assert.equal(msg.entity_ids, undefined, "the whole logbook");
  const m = card._items;
  assert.equal(m.state, "ok");
  assert.equal(m.items.length, LOG.length);
  assert.deepEqual(json(m.counts), { people: 1, openings: 3, devices: 8, alerts: 2 });
  assert.equal(m.alerts, 0, "the alarm is disarmed now");
  assert.ok(m.open, "the bedroom window is still open");
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /<div class="title">Today at home<\/div>/);
  assert.match(html, /<span class="bpt">14 events<\/span>/);
  assert.match(html, /<div class="subt">Friday, November 27<\/div>/);
  assert.ok(html.indexOf(">Afternoon<") < html.indexOf(">Morning<"), "afternoon first");
  assert.match(html, /<button class="ev t-media" data-id="media_player.tv">/);
  assert.match(html, /<span class="et">5:50 PM<\/span>/);
  assert.match(html, /<span class="en">Living room<span class="ec">×3<\/span><\/span><span class="es">On<\/span>/);
  assert.match(html, /<span class="en">Front door<span class="ec">×2<\/span><\/span><span class="es">Closed<\/span>/);
  assert.match(html, /<span class="en">Morning lights<\/span><span class="es">triggered by time<\/span>/);
  assert.match(html, /<button class="ev t-idle">[\s\S]*?Home Assistant[\s\S]*?started/, "an entry with no entity opens nothing");
  assert.match(html, /<ha-card class="lvl-open">/);
  assert.doesNotMatch(html, /class="more"/, "10 rows: under max_events");
});

test("filter pills: only the categories with entries; a click filters, a missing category shows all", async () => {
  const card = await make("timeline-card");
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /<button class="fp on" data-f="all" aria-pressed="true">All<\/button>/);
  assert.match(html, /data-f="alerts" aria-pressed="false">Alerts<span class="fn">2<\/span>/);
  card._filter = "people";
  const people = redraw(card);
  assert.match(people, /data-id="person.sam"/);
  assert.doesNotMatch(people, /data-id="light.living_room"/);
  card._filter = "nothing-here";
  assert.match(redraw(card), /data-id="light.living_room"/);
  const one = await make("timeline-card", { entities: ["light.living_room"] });
  assert.doesNotMatch(one.shadowRoot.innerHTML, /class="filters"/, "a lone category needs no filter");
});

test("max_events: the first rows, then Show all and Show less", async () => {
  const card = await make("timeline-card", { max_events: 4 });
  assert.equal((card.shadowRoot.innerHTML.match(/class="ev /g) || []).length, 4);
  assert.match(card.shadowRoot.innerHTML, /<button class="more">Show all \(10\)<\/button>/);
  card._all = true;
  const all = redraw(card);
  assert.equal((all.match(/class="ev /g) || []).length, 10);
  assert.match(all, />Show less</);
});

test("fold: false shows every change", async () => {
  const card = await make("timeline-card", { fold: false });
  assert.match(card.shadowRoot.innerHTML, /<button class="more">Show all \(14\)<\/button>/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /class="ec"/);
});

test("entities, exclude and hours_to_show", async () => {
  const hass = makeHass();
  const card = await make("timeline-card", { entities: ["person.sam", "vacuum.robot"], hours_to_show: 24, exclude: ["vacuum.*"] }, hass);
  assert.deepEqual(json(hass.calls[0].entity_ids), ["person.sam", "vacuum.robot"]);
  assert.equal(Date.parse(hass.calls[0].start_time), NOW - 24 * 3600000);
  assert.deepEqual(json(card._items.items.map((i) => i.id)), ["person.sam"]);
  assert.match(card.shadowRoot.innerHTML, /<div class="title">Last 24 hours<\/div>/);
});

test("an active alert turns the pill red and puts a beacon on the roof", async () => {
  const states = { ...STATES, "binary_sensor.kitchen_leak": { ...STATES["binary_sensor.kitchen_leak"], state: "on" } };
  const log = [...LOG, { when: at(17, 52), entity_id: "binary_sensor.kitchen_leak", state: "on" }];
  const card = await make("timeline-card", {}, makeHass({ states, log }));
  const html = card.shadowRoot.innerHTML;
  assert.equal(card._items.alerts, 1);
  assert.match(html, /<ha-card class="lvl-alert">/);
  assert.match(html, /<span class="bpt">1 alert<\/span>/);
  assert.match(html, /class="beacon"/);
  assert.match(html, /<button class="ev t-alert" data-id="binary_sensor.kitchen_leak">/);
});

test("the REST API when there is no WebSocket; loading, error and nothing yet", async () => {
  const rest = makeHass({ ws: false });
  const card = await make("timeline-card", { entities: ["person.sam"] }, rest);
  assert.match(rest.calls[0][1], /^logbook\/2026-11-2[67]T\d\d%3A00%3A00\.000Z\?end_time=.+&entity=person\.sam$/);
  assert.equal(card._items.items.length, 1);
  const failed = await make("timeline-card", {}, makeHass({ log: "fail" }));
  assert.match(failed.shadowRoot.innerHTML, /The logbook could not be read/);
  const empty = await make("timeline-card", {}, makeHass({ log: [] }));
  assert.match(empty.shadowRoot.innerHTML, /Nothing has happened yet/);
  assert.match(empty.shadowRoot.innerHTML, /<span class="bpt">0 events<\/span>/);
  const quiet = new cards["timeline-card"]();
  quiet.attachShadow();
  quiet.setConfig({ type: "custom:timeline-card" });
  quiet.hass = makeHass({ ws: false, callApi: undefined });
  assert.match(quiet.shadowRoot.innerHTML, /Loading…/);
});

test("the logbook is read again after a minute, not on every update", async () => {
  const hass = makeHass();
  const card = await make("timeline-card", {}, hass);
  card.hass = hass;
  card.hass = hass;
  await settle();
  assert.equal(hass.calls.length, 1);
  card._log.at -= 61000;
  card.hass = hass;
  await settle();
  assert.equal(hass.calls.length, 2);
});

test("the rows open their entity's details; the filters and Show all redraw", async () => {
  const card = await make("timeline-card", { max_events: 2 });
  const events = [];
  card.dispatchEvent = (e) => events.push(e.detail?.entityId);
  const node = (dataset) => ({ dataset, addEventListener(_t, fn) { this.fn = fn; } });
  const rows = [node({ id: "person.sam" })];
  const pills = [node({ f: "openings" })];
  const more = node({});
  card.shadowRoot.querySelectorAll = (s) => (s.includes(".ev[data-id]") ? rows : s === ".fp" ? pills : []);
  card.shadowRoot.querySelector = (s) => (s === ".more" ? more : fakeNode());
  card._bindAfter(card.shadowRoot);
  rows[0].fn();
  assert.deepEqual(events, ["person.sam"]);
  pills[0].fn();
  assert.equal(card._filter, "openings");
  more.fn();
  assert.equal(card._all, true);
});

test("mini card: the title with the count, then the last entry and how long ago", async () => {
  const card = await make("timeline-mini-card");
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /<ha-card class="lvl-open bn">/);
  assert.match(html, /<span class="bpt">14 events<\/span>/);
  assert.match(html, /<button class="subt evt" data-id="media_player.tv"[^>]*>TV · Playing · 3 minutes ago<\/button>/);
  card._zoomed = true;
  assert.match(redraw(card), /class="list"/);
});

test("night: the dark theme lights the windows and darkens the sky", async () => {
  const card = await make("timeline-card", {}, makeHass({ themes: { darkMode: true } }));
  assert.match(card.shadowRoot.innerHTML, /class="banner night"/);
  assert.match(card.shadowRoot.innerHTML, /fill="#ffd86b"/);
  const day = await make("timeline-card", { illustration_theme: "day" }, makeHass({ themes: { darkMode: true } }));
  assert.doesNotMatch(day.shadowRoot.innerHTML, /class="banner night"/);
  const plain = await make("timeline-card", { illustration: false });
  assert.doesNotMatch(plain.shadowRoot.innerHTML, /class="banner/);
  assert.match(plain.shadowRoot.innerHTML, /<span class="bpt">14 events<\/span>/);
});

test("plurals: the few form where the language has one", async () => {
  const hass = makeHass({ language: "ru", locale: { language: "ru" }, log: LOG.slice(0, 3) });
  const card = await make("timeline-card", { fold: false }, hass);
  assert.match(card.shadowRoot.innerHTML, /3 события/);
  const sl = await make("timeline-card", { language: "sl" });
  assert.deepEqual([1, 2, 3, 5, 102].map((n) => sl._tn("events", n)), ["1 dogodek", "2 dogodka", "3 dogodki", "5 dogodkov", "102 dogodka"]);
});

test("translations: every language has every English key", () => {
  const en = Object.keys(tl.TL_I18N.en);
  for (const [lang, table] of Object.entries(tl.TL_I18N)) assert.deepEqual(en.filter((k) => !(k in table)), [], lang);
  assert.equal(Object.keys(tl.TL_I18N).length, 22);
});

test("the editor writes only what differs from the defaults", () => {
  const ed = new (tl.customElements.get("timeline-card-editor"))();
  ed.setConfig({ type: "custom:timeline-card" });
  ed.hass = makeHass();
  const form = ed.children[0];
  const names = form.schema.flatMap((s) => (s.schema ? s.schema.map((x) => x.name) : [s.name]));
  for (const n of ["entities", "exclude", "hours_to_show", "max_events", "show_filters", "fold", "illustration_theme", "language"]) assert.ok(names.includes(n), n);
  let out;
  ed.dispatchEvent = (e) => (out = e.detail.config);
  form.listeners["value-changed"]({ detail: { value: { type: "custom:timeline-card", max_events: 12, fold: true, entities: ["person.sam"] } } });
  assert.deepEqual(json(out), { type: "custom:timeline-card", entities: ["person.sam"] });
  const mini = new (tl.customElements.get("timeline-mini-card-editor"))();
  mini.setConfig({ type: "custom:timeline-mini-card" });
  mini.hass = makeHass();
  assert.ok(mini.children[0].schema.some((s) => s.name === "zoom"));
});
