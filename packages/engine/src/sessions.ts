import type { Phrase } from "@atc/types";
import { p } from "./phrases";

/**
 * Which market is awake.
 *
 * Gold and the majors do not behave the same way at every hour. The same
 * demand zone that holds during the London/New York overlap gets wicked
 * through at 03:00 UTC on volume nobody is defending, and a trader who only
 * sees "grade A setup" has no way to tell those two apart. This module is the
 * missing axis.
 *
 * Sessions are defined in the exchange's own local hours and converted with
 * `Intl`, not written down as fixed UTC windows. The usual retail table —
 * "London is 08:00-17:00 GMT" — is wrong for seven months of the year, and
 * being an hour out is exactly the error that puts the overlap in the wrong
 * place. Letting the platform's timezone database answer means DST, and any
 * future change to it, is handled rather than approximated.
 */
export type TradingSession = "asia" | "london" | "newYork";

interface SessionDef {
  id: TradingSession;
  timeZone: string;
  /** Local opening hour, inclusive. */
  openHour: number;
  /** Local closing hour, exclusive. */
  closeHour: number;
}

/**
 * Desk hours, not the retail "forex session" tables, which disagree with each
 * other by an hour or two depending on who printed them. 08:00-17:00 local is
 * when the people who move size are actually at work.
 */
const DEFS: SessionDef[] = [
  { id: "asia", timeZone: "Asia/Tokyo", openHour: 9, closeHour: 18 },
  { id: "london", timeZone: "Europe/London", openHour: 8, closeHour: 17 },
  { id: "newYork", timeZone: "America/New_York", openHour: 8, closeHour: 17 },
];

export const SESSIONS: TradingSession[] = DEFS.map((d) => d.id);

/**
 * `Intl.DateTimeFormat` construction is the expensive part, and this runs on
 * every render of the home screen. The formatters are stateless, so one per
 * zone for the life of the process is safe.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = FORMATTERS.get(timeZone);
  if (existing) return existing;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    // `hour12: false` alone still renders midnight as "24" under some ICU
    // builds, which would read as hour 24 and silently break every comparison
    // below. `h23` is the one that promises 00-23.
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, made);
  return made;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Wall {
  /** 0 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
}

function wallClock(timeZone: string, at: Date): Wall {
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type === "weekday") weekday = Math.max(0, WEEKDAYS.indexOf(part.value));
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return { weekday, hour, minute };
}

function isOpen(def: SessionDef, at: Date): boolean {
  const { weekday, hour } = wallClock(def.timeZone, at);
  if (weekday === 0 || weekday === 6) return false;
  return hour >= def.openHour && hour < def.closeHour;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Minutes until this session next opens.
 *
 * Found by walking forward on the UTC hour grid rather than by converting a
 * local wall-clock time back to an instant. That inverse conversion is the one
 * that has no correct answer twice a year — a local hour can be skipped or
 * repeated at a DST boundary — whereas asking "is it open at this instant" is
 * always well defined. Every session opens on a whole local hour and every
 * zone here is a whole-hour offset, so the grid cannot step over an opening.
 */
function minutesUntilOpen(def: SessionDef, at: Date): number | null {
  const firstBoundary = Math.ceil(at.getTime() / HOUR_MS) * HOUR_MS;
  // A full week plus a day, so a Friday-evening check still finds Monday even
  // if a public holiday were ever added to these definitions.
  for (let i = 0; i < 24 * 8; i += 1) {
    const probe = new Date(firstBoundary + i * HOUR_MS);
    if (isOpen(def, probe)) return Math.round((probe.getTime() - at.getTime()) / MINUTE_MS);
  }
  return null;
}

export interface SessionState {
  id: TradingSession;
  open: boolean;
  /** Minutes until this session closes if open, or until it opens if not. */
  minutesToChange: number | null;
}

/**
 * How much of the market is actually participating.
 *
 * `thin` is the one worth acting on. It is not "nothing is happening" — price
 * still moves, which is the problem. It means the move is being made by fewer
 * participants than the structure on the chart was built by.
 */
export type Liquidity = "closed" | "thin" | "normal" | "high";

/**
 * The same union as a value, so a caller that has to name every level — a
 * dictionary, a legend, a test — can enumerate it instead of restating it.
 * A restated list is one that stops matching the day a level is added.
 */
export const LIQUIDITY_LEVELS: Liquidity[] = ["closed", "thin", "normal", "high"];

export interface SessionReading {
  sessions: SessionState[];
  active: TradingSession[];
  /** London and New York both open: the deepest four hours of the day. */
  overlap: boolean;
  /**
   * The spot FX week is shut. Crypto is not — this flag is about the asset,
   * so callers scanning BTC should ignore it.
   */
  fxClosed: boolean;
  liquidity: Liquidity;
  note: Phrase;
  /** The next session to open, when none is. */
  nextOpen: { id: TradingSession; minutes: number } | null;
}

/**
 * The FX week: open Sunday 17:00 New York, shut Friday 17:00 New York.
 *
 * Anchored to New York rather than to UTC because that is where the week
 * actually turns over, and it means the boundary follows US DST without a
 * second rule.
 */
function fxIsClosed(at: Date): boolean {
  const { weekday, hour } = wallClock("America/New_York", at);
  if (weekday === 6) return true;
  if (weekday === 0) return hour < 17;
  if (weekday === 5) return hour >= 17;
  return false;
}

export function readSessions(at: Date = new Date()): SessionReading {
  const sessions: SessionState[] = DEFS.map((def) => {
    const open = isOpen(def, at);
    if (open) {
      const { hour, minute } = wallClock(def.timeZone, at);
      return { id: def.id, open, minutesToChange: (def.closeHour - hour) * 60 - minute };
    }
    return { id: def.id, open, minutesToChange: minutesUntilOpen(def, at) };
  });

  const active = sessions.filter((s) => s.open).map((s) => s.id);
  const overlap = active.includes("london") && active.includes("newYork");
  const fxClosed = fxIsClosed(at);

  let nextOpen: SessionReading["nextOpen"] = null;
  if (active.length === 0) {
    for (const s of sessions) {
      if (s.minutesToChange === null) continue;
      if (nextOpen === null || s.minutesToChange < nextOpen.minutes) {
        nextOpen = { id: s.id, minutes: s.minutesToChange };
      }
    }
  }

  const liquidity: Liquidity = fxClosed
    ? "closed"
    : overlap
      ? "high"
      : active.includes("london") || active.includes("newYork")
        ? "normal"
        : "thin";

  const note: Phrase =
    liquidity === "closed"
      ? p("session.note.closed", {
          minutes: nextOpen?.minutes ?? 0,
          session: p(`label.session.${nextOpen?.id ?? "asia"}`),
        })
      : liquidity === "high"
        ? p("session.note.overlap")
        : liquidity === "normal"
          ? p("session.note.active", {
              session: p(`label.session.${active.includes("london") ? "london" : "newYork"}`),
            })
          : active.length > 0
            ? p("session.note.asiaOnly")
            : p("session.note.gap", {
                minutes: nextOpen?.minutes ?? 0,
                session: p(`label.session.${nextOpen?.id ?? "london"}`),
              });

  return { sessions, active, overlap, fxClosed, liquidity, note, nextOpen };
}
