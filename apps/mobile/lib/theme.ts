/**
 * TypeScript mirror of the CSS variables defined in apps/mobile/global.css.
 * "Print-Room Precision" design system — amber-orange brand (h=38, HSL).
 *
 * - `THEME` is the raw token object for inline styles, animations, and
 *   anywhere a Tailwind class can't reach.
 * - `NAV_THEME` is the React Navigation theme — passed into <ThemeProvider />
 *   in app/_layout.tsx so headers, modals, and the back button match.
 *
 * If you change a variable in global.css, update the matching key here.
 * See apps/mobile/docs/rnr-migration.md §5 for the sync rule.
 */
import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";

export const THEME = {
  light: {
    background: "hsl(38 20% 97%)",
    foreground: "hsl(35 18% 9%)",
    card: "hsl(40 18% 100%)",
    cardForeground: "hsl(35 18% 9%)",
    popover: "hsl(40 18% 100%)",
    popoverForeground: "hsl(35 18% 9%)",
    primary: "hsl(35 18% 13%)",
    primaryForeground: "hsl(38 20% 97%)",
    secondary: "hsl(38 12% 93%)",
    secondaryForeground: "hsl(35 18% 13%)",
    muted: "hsl(38 10% 93%)",
    mutedForeground: "hsl(36 10% 42%)",
    accent: "hsl(38 15% 91%)",
    accentForeground: "hsl(35 18% 13%)",
    destructive: "hsl(4 72% 50%)",
    destructiveForeground: "hsl(38 20% 97%)",
    border: "hsl(38 14% 83%)",
    input: "hsl(38 14% 83%)",
    ring: "hsl(38 85% 52%)",
    radius: "0.25rem",
    chart1: "hsl(38 85% 52%)",
    chart2: "hsl(22 75% 50%)",
    chart3: "hsl(10 68% 46%)",
    chart4: "hsl(50 72% 60%)",
    chart5: "hsl(55 55% 72%)",

    // 3J Tracker brand — amber-orange
    brand: "hsl(38 85% 52%)",
    brandForeground: "hsl(0 0% 100%)",
    brandHover: "hsl(38 80% 47%)",
    brandActive: "hsl(38 78% 43%)",
    success: "hsl(145 56% 40%)",
    warning: "hsl(40 92% 50%)",
    info: "hsl(216 82% 52%)",
    priority: "hsl(25 95% 53%)",
    codeSurface: "hsl(38 10% 91%)",
    // Surface elevation tiers — see global.css for the full scale.
    surface1: "hsl(38 14% 97%)",
    surface2: "hsl(38 10% 89%)",
  },
  dark: {
    background: "hsl(34 12% 11%)",
    foreground: "hsl(38 10% 93%)",
    card: "hsl(34 12% 14%)",
    cardForeground: "hsl(38 10% 93%)",
    popover: "hsl(34 12% 14%)",
    popoverForeground: "hsl(38 10% 93%)",
    primary: "hsl(38 10% 88%)",
    primaryForeground: "hsl(34 12% 11%)",
    secondary: "hsl(35 10% 19%)",
    secondaryForeground: "hsl(38 10% 93%)",
    muted: "hsl(35 8% 19%)",
    mutedForeground: "hsl(37 8% 55%)",
    accent: "hsl(35 11% 21%)",
    accentForeground: "hsl(38 10% 93%)",
    destructive: "hsl(6 65% 60%)",
    destructiveForeground: "hsl(38 20% 97%)",
    border: "hsl(35 8% 22%)",
    input: "hsl(35 8% 25%)",
    ring: "hsl(38 85% 55%)",
    radius: "0.25rem",
    chart1: "hsl(38 85% 58%)",
    chart2: "hsl(22 68% 54%)",
    chart3: "hsl(10 60% 50%)",
    chart4: "hsl(50 65% 60%)",
    chart5: "hsl(34 12% 38%)",

    // 3J Tracker brand — slightly brighter on dark
    brand: "hsl(38 85% 58%)",
    brandForeground: "hsl(34 12% 9%)",
    brandHover: "hsl(38 80% 54%)",
    brandActive: "hsl(38 76% 50%)",
    success: "hsl(145 50% 52%)",
    warning: "hsl(40 90% 54%)",
    info: "hsl(216 72% 60%)",
    priority: "hsl(25 90% 60%)",
    codeSurface: "hsl(35 8% 18%)",
    // Dark elevation tiers — lightness INCREASES with elevation.
    surface1: "hsl(34 10% 15%)",
    surface2: "hsl(34 8% 21%)",
  },
};

export const NAV_THEME: Record<"light" | "dark", Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.brand,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.brand,
      text: THEME.dark.foreground,
    },
  },
};
