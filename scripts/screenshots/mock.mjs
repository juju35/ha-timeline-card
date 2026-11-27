// The mock home of the screenshots and animations: a neutral day (a person coming home, a door, a window, a light, a
// vacuum, an alarm, a TV) and its logbook, answered by the card's callWS. The clock is fixed, so that a capture only
// changes when the card does: 27 November 2026, 17:53.
const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes, last_changed: "2026-11-27T00:00:00Z" });
const NOW = new Date(2026, 10, 27, 17, 53).getTime();
const at = (h, m, s = 0) => new Date(2026, 10, 27, h, m, s).getTime() / 1000;

const STATES = {
  "person.sam": st("person.sam", "home", { friendly_name: "Sam" }),
  "binary_sensor.front_door": st("binary_sensor.front_door", "off", { friendly_name: "Front door", device_class: "door" }),
  "binary_sensor.bedroom_window": st("binary_sensor.bedroom_window", "on", { friendly_name: "Bedroom window", device_class: "window" }),
  "binary_sensor.kitchen_leak": st("binary_sensor.kitchen_leak", "off", { friendly_name: "Kitchen leak", device_class: "moisture" }),
  "light.living_room": st("light.living_room", "on", { friendly_name: "Living room light" }),
  "vacuum.robot": st("vacuum.robot", "docked", { friendly_name: "Robot vacuum" }),
  "alarm_control_panel.home": st("alarm_control_panel.home", "disarmed", { friendly_name: "Alarm" }),
  "media_player.tv": st("media_player.tv", "playing", { friendly_name: "Living room TV" }),
  "lock.front": st("lock.front", "locked", { friendly_name: "Front lock" }),
};

const LOG = [
  { when: at(6, 58), name: "Home Assistant", message: "started", domain: "homeassistant" },
  { when: at(7, 0), entity_id: "automation.morning", name: "Morning lights", message: "triggered by time" },
  { when: at(8, 12), entity_id: "binary_sensor.front_door", state: "on" },
  { when: at(8, 12, 40), entity_id: "binary_sensor.front_door", state: "off" },
  { when: at(8, 13), entity_id: "alarm_control_panel.home", state: "armed_away" },
  { when: at(8, 13, 20), entity_id: "lock.front", state: "locked" },
  { when: at(10, 0), entity_id: "vacuum.robot", state: "cleaning" },
  { when: at(10, 41), entity_id: "vacuum.robot", state: "docked" },
  { when: at(13, 10), entity_id: "light.living_room", state: "on" },
  { when: at(13, 20), entity_id: "light.living_room", state: "off" },
  { when: at(13, 25), entity_id: "light.living_room", state: "on" },
  { when: at(14, 22), entity_id: "binary_sensor.bedroom_window", state: "on" },
  { when: at(17, 44), entity_id: "alarm_control_panel.home", state: "disarmed" },
  { when: at(17, 45), entity_id: "person.sam", state: "home" },
  { when: at(17, 50), entity_id: "media_player.tv", state: "playing" },
];

// `scene`: day (a quiet day), alert (a leak right now), empty (nothing yet).
const SCENES = {
  day: { log: LOG, states: STATES },
  alert: {
    log: [...LOG, { when: at(17, 52), entity_id: "binary_sensor.kitchen_leak", state: "on" }],
    states: { ...STATES, "binary_sensor.kitchen_leak": { ...STATES["binary_sensor.kitchen_leak"], state: "on" } },
  },
  empty: { log: [], states: STATES },
};

// The page's clock and the card's callWS, as script source: window.Date fixed at NOW, window.__ws answering
// logbook/get_events from the entries put on the hass object (`this.__log`), and Home Assistant's state formatting.
export const pageScript = () => `(() => {
  const N = ${NOW};
  const R = Date;
  window.Date = class extends R {
    constructor(...a) { super(...(a.length ? a : [N])); }
    static now() { return N; }
  };
  window.__ws = async function () { return this.__log || []; };
})();`;

const LABELS = { on: "On", off: "Off", home: "Home", docked: "Docked", cleaning: "Cleaning", playing: "Playing", disarmed: "Disarmed", armed_away: "Armed away", locked: "Locked" };
const SPECIAL = { door: { on: "Open", off: "Closed" }, window: { on: "Open", off: "Closed" }, moisture: { on: "Wet", off: "Dry" } };
// Serialised with the hass object: a function source the page turns back into Home Assistant's formatEntityState.
const FORMAT = `(so, s = so.state) => (${JSON.stringify(SPECIAL)}[so.attributes?.device_class]?.[s] ?? ${JSON.stringify(LABELS)}[s] ?? s)`;

export const setup = (s) => {
  const v = SCENES[s.scene];
  return {
    hass: { language: "en", locale: { language: "en" }, states: v.states, __log: v.log, __format: FORMAT },
    config: { ...s.config },
    open: s.open,
  };
};

// Creates the card with Home Assistant's state formatting (a function, rebuilt in the page), waits for the logbook,
// then clicks `open` (a selector) when given.
export const mount = async (page, { tag, hass, config, dark, open }) => {
  await page.evaluate(
    ({ tag, hass, config, dark }) => {
      const el = document.createElement(tag);
      el.setConfig({ type: `custom:${tag}`, ...config });
      el.hass = { ...hass, themes: { darkMode: dark }, callService: async () => {}, callWS: window.__ws, formatEntityState: new Function(`return ${hass.__format}`)() };
      document.getElementById("root").appendChild(el);
    },
    { tag, hass, config, dark },
  );
  await page.waitForTimeout(300);
  if (open)
    await page.evaluate((open) => {
      const el = document.getElementById("root").firstElementChild;
      el.shadowRoot.querySelector(open).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
    }, open);
  await page.waitForTimeout(300);
};
