"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme preference (§5 of the Phase 5 brief).
 *
 * Three choices rather than two. "system" is the default because a trader who
 * has already told their OS they want light mode should not have to tell this
 * app as well — and because the honest default for a preference we have not
 * been given is to follow the one we have.
 */
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** What is actually painted. "system" always resolves to one of these. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "atc.theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

/**
 * The script that runs before first paint.
 *
 * This has to be inline and synchronous in `<head>`. React cannot do this job:
 * by the time a component effect runs the browser has already painted, and on
 * a dark-by-default stylesheet that paint is a full-screen black flash for
 * every light-mode user on every navigation. So the smallest possible script
 * reads the stored choice and stamps `data-theme` on `<html>` while the parser
 * is still blocked.
 *
 * It is wrapped in try/catch because `localStorage` throws outright in some
 * privacy modes, and a theme preference is never worth breaking the page for.
 * The fallback is the OS preference, then dark.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(c!=="light"&&c!=="dark"){c=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",c)}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`;

interface ThemeContextValue {
  /** What the user picked, including "system". This is what the UI shows. */
  choice: ThemeChoice;
  /** What is painted right now. This is what the chart needs. */
  theme: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
  /** True once the stored choice has been read. */
  hydrated: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * Chosen per environment at module load, never per render, so this is still a
 * single unconditional hook call. The plain layout effect would log a warning
 * during SSR for work it cannot do there anyway.
 */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [system, setSystem] = useState<ResolvedTheme>("dark");
  const [hydrated, setHydrated] = useState(false);

  // Read the stored choice after mount. The inline script has already applied
  // the right colours, so this is only catching React up to the DOM — it
  // cannot cause a flash, and it must not be allowed to: that is why the
  // attribute is never written until `hydrated` is true.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage disabled: follow the system for this session.
    }
    if (isThemeChoice(stored)) setChoiceState(stored);
    setSystem(systemTheme());
    setHydrated(true);
  }, []);

  // Follow the OS while the choice is "system". Tracked even when it is not,
  // because the user can switch back to "system" and must get the current
  // answer rather than whatever it was at mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(LIGHT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "light" : "dark");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme: ResolvedTheme = choice === "system" ? system : choice;

  // A layout effect, for two reasons. It lands before the browser paints, so
  // the switch never shows a frame of the old colours; and layout effects all
  // run before any passive effect, which is what lets PriceChart read the new
  // custom-property values off the DOM in its own (passive) effect. Flip this
  // to useEffect and the chart silently repaints one theme behind, because
  // effects run child-first and the chart would read the attribute this line
  // has not written yet.
  useBrowserLayoutEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme, hydrated]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not fatal: the switch still applies for this session.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, theme, setChoice, hydrated }),
    [choice, theme, setChoice, hydrated],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
