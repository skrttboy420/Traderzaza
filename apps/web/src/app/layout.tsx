import type { Metadata, Viewport } from "next";

import { BottomNav, SideNav } from "@/components/BottomNav";
import { LocaleProvider } from "@/i18n/provider";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Trading Coach",
  description:
    "Signals with the reasoning attached. Scans supply/demand setups across timeframes, grades them, gives entry, stop and targets, and shows you every input behind the call. Educational tool, not financial advice.",
  applicationName: "AI Trading Coach",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Mobile browsers paint the address bar with this, so it has to follow the
  // theme or a light-mode user gets a black bar above a white page. These
  // match --color-bg in each theme; keep them in step with globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang is set to the default locale and updated client-side by LocaleProvider
  // once the persisted preference has been read. data-theme is left off the
  // server markup entirely: the stylesheet's defaults are the dark theme, and
  // the inline script below stamps the real value before the first paint.
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* Must run before paint — see THEME_INIT_SCRIPT for why this cannot
            be a React effect. The content is a build-time constant, never user
            input, so there is nothing here to inject. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>
            <div className="flex min-h-dvh">
              <SideNav />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
            <BottomNav />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
