import type { Metadata, Viewport } from "next";
import { Barlow, Epilogue, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { cn } from "@multica/ui/lib/utils";
import { WebProviders } from "@/components/web-providers";
import type { SupportedLocale } from "@multica/core/i18n";
import { RESOURCES } from "@multica/views/locales";
import { getRequestLocale } from "@/lib/request-locale";
import "./globals.css";

// Barlow — the UI workhorse. Industrial wayfinding heritage: each glyph
// has clean, confident terminals. Slightly condensed optical at normal
// weight (not actually condensed width — just the feel). Used for all
// body text, navigation labels, buttons, and data cells.
//
// The full `--font-sans` stack (Barlow + the per-locale CJK fallback chain) is
// assembled in static CSS in ./globals.css so it can be overridden per
// `<html lang>` (Japanese Kanji need a Japanese-first CJK stack).
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-barlow",
});

// Epilogue — variable display face for headings. Unusual x-height and a
// slightly opinionated terminal on certain glyphs makes it memorable without
// being decorative. Used only for h1/h2/h3 and card titles via --font-heading.
const epilogue = Epilogue({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-epilogue",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

// JetBrains Mono — issue identifiers, code snippets, keyboard shortcuts.
// Not used as lazy "technical vibe" decoration — only for actual monospace
// content where character-level alignment matters.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#231f1a" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://tracker-v1.3jtech.app"),
  title: {
    default: "3J Tracker",
    template: "%s | 3J Tracker",
  },
  description:
    "3J Technologies internal project tracker — assign tasks, track progress, manage your team.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
  openGraph: {
    type: "website",
    siteName: "3J Tracker",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@3jtechnologies",
    creator: "@3jtechnologies",
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// HTML lang attribute uses BCP-47 region tags that screen readers and font
// stacks recognize widely. i18next keeps `zh-Hans` as its internal locale
// (script subtag is what we actually translate against), but the html element
// expects a region-flavoured tag for accessibility tooling and CJK fallback.
const HTML_LANG: Record<SupportedLocale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
  ko: "ko-KR",
  ja: "ja-JP",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  const resources = { [locale]: RESOURCES[locale] };

  return (
    <html
      lang={HTML_LANG[locale]}
      suppressHydrationWarning
      className={cn("antialiased font-sans h-full", barlow.variable, epilogue.variable, jetbrainsMono.variable)}
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <WebProviders locale={locale} resources={resources}>
            {children}
          </WebProviders>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
