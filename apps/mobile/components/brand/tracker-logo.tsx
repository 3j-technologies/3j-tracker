/**
 * 3J Tracker wordmark / sigil. Simple "3J" monogram using the amber brand
 * colour on a transparent background. Used on login, verify, and splash.
 *
 * react-native-svg does not resolve CSS `currentColor`, so callers must pass
 * `color` explicitly. For theme-aware usage, pair with `useColorScheme` +
 * `THEME` token from `@/lib/theme`.
 */
import Svg, { Rect, Text as SvgText, G } from "react-native-svg";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

interface TrackerLogoProps {
  size?: number;
  color?: string;
}

export function TrackerLogo({ size = 48, color }: TrackerLogoProps) {
  const { isDarkColorScheme } = useColorScheme();
  const brand = isDarkColorScheme ? THEME.dark.brand : THEME.light.brand;
  const resolvedColor = color ?? brand;

  // Amber square background with "3J" monogram
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Rect x="0" y="0" width="48" height="48" rx="6" fill={resolvedColor} />
      <G>
        <SvgText
          x="24"
          y="33"
          textAnchor="middle"
          fill="#fff"
          fontSize="22"
          fontWeight="700"
          fontFamily="System"
        >
          3J
        </SvgText>
      </G>
    </Svg>
  );
}
