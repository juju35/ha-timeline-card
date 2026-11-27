// ── Timeline ─────────────────────────────────────────────────────────────────
// The logbook's entries over the card's window (since local midnight, or the last `hours_to_show` hours), brought down
// to { id, t (ms), state, name, message, domain }, then sorted into categories (people, openings, devices, alerts) with
// a tone (the colour of the charter: ok, warm, open, alert, idle, media), an icon and a part of the day.
export const TL_CATS = ["people", "openings", "devices", "alerts"];
const TL_OPENING_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
const TL_ALERT_CLASSES = new Set(["smoke", "moisture", "gas", "carbon_monoxide", "safety", "problem", "tamper"]);
// States that mean "off" or "at rest" for a device; anything else is active.
const TL_REST = new Set(["off", "idle", "docked", "standby", "paused", "closed", "unavailable", "unknown", "stopped", "returning"]);
const TL_ICONS = {
  person: "mdi:account",
  device_tracker: "mdi:cellphone",
  lock: "mdi:lock",
  cover: "mdi:window-shutter",
  alarm_control_panel: "mdi:shield-home",
  siren: "mdi:alarm-light",
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch",
  fan: "mdi:fan",
  media_player: "mdi:play-circle",
  vacuum: "mdi:robot-vacuum",
  climate: "mdi:thermostat",
  automation: "mdi:robot",
  script: "mdi:script-text",
  input_boolean: "mdi:toggle-switch-outline",
};
const TL_CLASS_ICONS = {
  door: ["mdi:door-closed", "mdi:door-open"],
  window: ["mdi:window-closed", "mdi:window-open-variant"],
  garage_door: ["mdi:garage", "mdi:garage-open"],
  opening: ["mdi:square-outline", "mdi:square-rounded-outline"],
  smoke: ["mdi:smoke-detector", "mdi:smoke-detector-alert"],
  moisture: ["mdi:water-check", "mdi:water-alert"],
  gas: ["mdi:gas-cylinder", "mdi:gas-cylinder"],
  carbon_monoxide: ["mdi:molecule-co", "mdi:molecule-co"],
  safety: ["mdi:shield-check", "mdi:shield-alert"],
  problem: ["mdi:check-circle-outline", "mdi:alert-circle"],
  tamper: ["mdi:shield-check", "mdi:shield-alert"],
};

const tlDomain = (id) => String(id || "").split(".")[0];
const tlClass = (stateObj) => stateObj?.attributes?.device_class;
const tlOn = (state) => ["on", "open", "opening", "unlocked", "unlocking", "triggered", "detected"].includes(state);

// The category of an entity: a person, an opening (door, window, lock, cover), an alert (smoke, leak, alarm), else a device.
export const tlCategory = (id, stateObj) => {
  const domain = tlDomain(id);
  const dc = tlClass(stateObj);
  if (domain === "person" || domain === "device_tracker") return "people";
  if (domain === "lock" || domain === "cover" || (domain === "binary_sensor" && TL_OPENING_CLASSES.has(dc))) return "openings";
  if (domain === "alarm_control_panel" || domain === "siren" || (domain === "binary_sensor" && TL_ALERT_CLASSES.has(dc))) return "alerts";
  return "devices";
};

// The colour of an entry: green at home or all clear, blue open (or in another zone), red an alert, amber a device at
// work, violet a media playing, grey at rest.
export const tlTone = (cat, state) => {
  // An entry with no state (an automation triggered, Home Assistant started): at rest.
  if (!state) return "idle";
  if (cat === "people") return state === "home" ? "ok" : state === "not_home" ? "idle" : "open";
  if (cat === "alerts") {
    if (state === "triggered" || state === "on" || state === "pending") return "alert";
    return String(state).startsWith("armed") ? "warm" : "ok";
  }
  if (cat === "openings") return state === "jammed" ? "alert" : tlOn(state) ? "open" : "idle";
  if (state === "playing") return "media";
  return TL_REST.has(state) ? "idle" : "warm";
};

// Its icon: the entity's own, else one for its device class (open or closed) or its domain.
export const tlIcon = (id, stateObj, state) => {
  if (stateObj?.attributes?.icon) return stateObj.attributes.icon;
  const pair = TL_CLASS_ICONS[tlClass(stateObj)];
  if (pair && tlDomain(id) === "binary_sensor") return pair[tlOn(state) ? 1 : 0];
  if (tlDomain(id) === "lock") return state === "unlocked" ? "mdi:lock-open-variant" : "mdi:lock";
  return TL_ICONS[tlDomain(id)] || (id ? "mdi:eye" : "mdi:home-assistant");
};

// The part of the day an entry falls in (local time).
export const tlPart = (t) => {
  const h = new Date(t).getHours();
  return h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

// A logbook entry from the WebSocket (`when` in seconds) or the REST API (`when` an ISO date).
export const tlEntry = (e) => {
  const t = typeof e?.when === "number" ? e.when * 1000 : Date.parse(e?.when);
  if (!Number.isFinite(t)) return null;
  return { id: e.entity_id || "", t, state: e.state ?? "", name: e.name || "", message: e.message || "", domain: e.domain || tlDomain(e.entity_id) };
};

// An entity id against a pattern of `exclude` (`sensor.*`, `*_battery`): `*` stands for anything.
export const tlMatch = (id, pattern) => {
  const p = String(pattern || "");
  if (!p.includes("*")) return id === p;
  const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(id);
};

// Consecutive entries of the same entity (newest first) become one, with how many times it changed.
export const tlFold = (items) => {
  const out = [];
  for (const it of items) {
    const last = out.at(-1);
    if (last && it.id && last.id === it.id && last.part === it.part) last.count++;
    else out.push({ ...it, count: 1 });
  }
  return out;
};
