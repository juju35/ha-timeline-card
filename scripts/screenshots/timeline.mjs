// Renders the timeline cards with a mock logbook and saves the README screenshots.
// Usage: npm install && npm run build && node scripts/screenshots/timeline.mjs
// The alert stills and their GIFs come from animations.mjs.
import { pair, shoot } from "./harness.mjs";
import { mount, pageScript, setup } from "./mock.mjs";

const run = (prefix, tag, shots) => shoot({ prefix, tag, shots, setup, mount, ws: pageScript() });

await run("tl", "timeline-card", [
  ...pair("day", { scene: "day" }),
  ...pair("filter", { scene: "day", open: '.fp[data-f="openings"]' }),
  ...pair("more", { scene: "day", config: { max_events: 5 } }),
  ...pair("empty", { scene: "empty" }),
  ...pair("narrow", { scene: "day", width: 300, config: { max_events: 5 } }),
]);
await run("tl-mini", "timeline-mini-card", [...pair("day", { scene: "day" }), ...pair("zoom", { scene: "day", zoom: true, open: ".zoom", config: { max_events: 5 } })]);
