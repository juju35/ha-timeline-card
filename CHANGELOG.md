# Changelog

## 1.0.0 - 2026-11-27

### Features
- First release: `timeline-card` and `timeline-mini-card`. What happened at home today, from Home Assistant's logbook (or over the last `hours_to_show` hours): entries grouped by part of the day, newest first, each in the colour of its state (home, open, active, alert, at rest) with its icon. Filter pills by kind (people, openings, devices, alerts) for the kinds that have entries; repeated changes of an entity folded into one row (`×3`); the first `max_events` rows, then *Show all*. `entities` and `exclude` (with patterns such as `sensor.*`) choose what is shown. An illustrated header whose clock shows the time, with lit windows for a recent entry, an open door while an opening is open and a red beacon for an active alert. The mini card shows the count and the last entry; its zoom button opens the full timeline. The logbook is read once the card is on screen, then every minute.
