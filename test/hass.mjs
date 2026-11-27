// A mock Home Assistant with a person, two openings, a light, a vacuum, an alarm and a media player, and a logbook
// answered by callWS (logbook/get_events). The day is fixed by the tests (NOW): 27 November 2026, 17:53 local time.
export const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes, last_changed: "2026-11-27T00:00:00Z" });

export const NOW = new Date(2026, 10, 27, 17, 53).getTime();
// A logbook time today (seconds, as the WebSocket sends them).
export const at = (h, m, s = 0) => new Date(2026, 10, 27, h, m, s).getTime() / 1000;

export const STATES = {
  "person.sam": st("person.sam", "home", { friendly_name: "Sam" }),
  "binary_sensor.front_door": st("binary_sensor.front_door", "off", { friendly_name: "Front door", device_class: "door" }),
  "binary_sensor.bedroom_window": st("binary_sensor.bedroom_window", "on", { friendly_name: "Bedroom window", device_class: "window" }),
  "binary_sensor.kitchen_leak": st("binary_sensor.kitchen_leak", "off", { friendly_name: "Kitchen leak", device_class: "moisture" }),
  "light.living_room": st("light.living_room", "on", { friendly_name: "Living room" }),
  "vacuum.robot": st("vacuum.robot", "docked", { friendly_name: "Robot vacuum" }),
  "alarm_control_panel.home": st("alarm_control_panel.home", "disarmed", { friendly_name: "Alarm" }),
  "media_player.tv": st("media_player.tv", "playing", { friendly_name: "TV" }),
  "sensor.outdoor_temperature": st("sensor.outdoor_temperature", "9.5", { friendly_name: "Outdoor temperature" }),
};

export const LOG = [
  { when: at(6, 58), name: "Home Assistant", message: "started", domain: "homeassistant" },
  { when: at(7, 0), entity_id: "automation.morning", name: "Morning lights", message: "triggered by time" },
  { when: at(8, 12), entity_id: "binary_sensor.front_door", state: "on" },
  { when: at(8, 12, 40), entity_id: "binary_sensor.front_door", state: "off" },
  { when: at(8, 13), entity_id: "alarm_control_panel.home", state: "armed_away" },
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

const LABELS = { on: "On", off: "Off", home: "Home", not_home: "Away", docked: "Docked", cleaning: "Cleaning", playing: "Playing", disarmed: "Disarmed", armed_away: "Armed away", triggered: "Triggered" };
const DOOR = { on: "Open", off: "Closed" };

// Home Assistant's own state formatting, in English: doors and windows open or closed, the rest by state.
export const formatEntityState = (so, state = so.state) => (["door", "window"].includes(so.attributes?.device_class) ? DOOR[state] : (LABELS[state] ?? state));

export const makeHass = ({ log = LOG, ws = true, ...overrides } = {}) => {
  const hass = {
    language: "en",
    locale: { language: "en" },
    themes: { darkMode: false },
    states: STATES,
    formatEntityState,
    calls: [],
    ...overrides,
  };
  if (ws)
    hass.callWS = async (msg) => {
      hass.calls.push(msg);
      if (log === "fail") throw new Error("no logbook");
      return log;
    };
  else
    hass.callApi = async (method, path) => {
      hass.calls.push([method, path]);
      return log.map((e) => ({ ...e, when: new Date(e.when * 1000).toISOString() }));
    };
  return hass;
};
