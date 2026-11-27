// Records the animated state into screenshots/*.gif (needs ffmpeg): an active alert, whose badge and roof beacon
// pulse. Also saves the alert stills (the animation paused).
// Usage: npm install && npm run build && node scripts/screenshots/animations.mjs
// CSS animations are paused and stepped frame by frame, each one by a fraction of its own cycle, so every GIF loops
// cleanly whatever the machine's speed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardClip, iconsFor, launch, openPage, root, writeIfChanged } from "./harness.mjs";
import { mount, pageScript, setup } from "./mock.mjs";

const FPS = 20;
const WIDTH = 460;
// The pulse of the alert badge (rc-pulse, 1.6 s).
const CYCLE = 1.6;

const frameName = (i) => `f${String(i).padStart(3, "0")}.png`;

// Every decoded frame (RGBA) and its timing, as ffmpeg's per-frame MD5 list: equal lists, same animation.
const decodedFrames = (file) =>
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-pix_fmt", "rgba", "-f", "framemd5", "-"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .join("\n");

// A deterministic GIF: frames stepped in paused animations, a palette from those frames only, ordered dithering,
// bit-exact muxing. The file in place is only replaced when its decoded frames differ.
const encode = (dir, out) => {
  const gif = join(dir, "out.gif");
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%03d.png"),
    "-vf", `scale=${WIDTH + 32}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    "-fflags", "+bitexact", "-flags", "+bitexact", "-loop", "0", gif,
  ]);
  const target = `${root}${out}`;
  const same = existsSync(target) && decodedFrames(target) === decodedFrames(gif);
  if (!same) copyFileSync(gif, target);
  console.log(`${out}${same ? " (unchanged)" : ""}`);
};

// Steps every CSS animation of the page (shadow roots walked by hand) to `frac` of its own cycle.
const step = (page, frac) =>
  page.evaluate((f) => {
    const anims = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll("*")) {
        anims.push(...el.getAnimations());
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    for (const a of anims) {
      a.pause();
      a.currentTime = (3 + f) * a.effect.getComputedTiming().duration;
    }
  }, frac);

const browser = await launch();
for (const theme of ["light", "dark"]) {
  const suffix = theme === "dark" ? "-dark" : "";
  for (const [tag, name] of [
    ["timeline-card", "tl-alert"],
    ["timeline-mini-card", "tl-mini-alert"],
  ]) {
    const width = tag === "timeline-card" ? WIDTH : 380;
    const page = await openPage(browser, { theme, width, icons: iconsFor([]), label: `${name}${suffix}`, ws: pageScript() });
    const { hass, config } = setup({ scene: "alert", config: { max_events: 5 } });
    await mount(page, { tag, hass, config, dark: theme === "dark" });
    const clip = await cardClip(page, width);
    const still = `screenshots/${name}${suffix}.png`;
    const png = await page.screenshot({ clip, animations: "disabled" });
    console.log(`${still}${(await writeIfChanged(page, `${root}${still}`, png)) ? "" : " (unchanged)"}`);
    if (tag === "timeline-card") {
      const dir = mkdtempSync(join(tmpdir(), "tl-frames-"));
      const frames = Math.round(FPS * CYCLE);
      for (let i = 0; i < frames; i++) {
        await step(page, i / frames);
        await page.screenshot({ path: join(dir, frameName(i)), clip, animations: "allow" });
      }
      encode(dir, `screenshots/${name}${suffix}.gif`);
      rmSync(dir, { recursive: true });
    }
    await page.close();
  }
}
await browser.close();
