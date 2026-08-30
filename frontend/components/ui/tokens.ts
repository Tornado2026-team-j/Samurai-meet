import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  brand: {
    sky: "#5ec5f5",
    gold: "#e7b454",
  },
  text: {
    primary: "#101318",
    secondary: "#535353",
    muted: "#949494",
    subtle: "#7d7d7d",
    inverse: "#ffffff",
    black: "#000000",
  },
  surface: {
    screen: "#ffffff",
    default: "#ffffff",
    subtle: "#f7f7f7",
    raised: "#ffffff",
    blueSoft: "#eff8ff",
    goldSoft: "#fff8e8",
    warningSoft: "#fffaf0",
    dangerSoft: "#fff5f4",
    successSoft: "#eef8f2",
  },
  border: {
    default: "#d4d4d4",
    subtle: "#e4e4e4",
    muted: "#949494",
    blue: "#caeafd",
    blueStrong: "#b8dff1",
    gold: "#f7dfaa",
    danger: "#f3b5af",
    dangerStrong: "#d92d20",
  },
  state: {
    danger: "#b42318",
    dangerDark: "#7a271a",
    warning: "#7a5a00",
    link: "#168df0",
    success: "#3d9a68",
  },
  overlay: {
    scrim: "rgba(0, 0, 0, 0.45)",
    sheet: "rgba(31, 31, 31, 0.35)",
  },
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  "4xl": 32,
  "5xl": 36,
  "6xl": 42,
  "7xl": 48,
} as const;

export const radius = {
  none: 0,
  xs: 5,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  "2xl": 20,
  "3xl": 24,
  pill: 999,
  header: 50,
} as const;

type FontWeight = NonNullable<TextStyle["fontWeight"]>;

function textStyle(
  fontSize: number,
  lineHeight: number,
  fontWeight: FontWeight = "400",
): TextStyle {
  return {
    fontSize,
    fontWeight,
    letterSpacing: 0,
    lineHeight,
  };
}

export const typography = {
  hero: textStyle(30, 36, "900"),
  title1: textStyle(27, 34, "900"),
  title2: textStyle(24, 30, "800"),
  title3: textStyle(20, 26, "900"),
  heading: textStyle(18, 24, "900"),
  subheading: textStyle(16, 20, "900"),
  body: textStyle(15, 21, "700"),
  bodyStrong: textStyle(16, 24, "700"),
  caption: textStyle(13, 18, "700"),
  captionStrong: textStyle(13, 17, "800"),
  small: textStyle(12, 16, "700"),
  smallStrong: textStyle(12, 15, "900"),
  micro: textStyle(10, 12, "700"),
} as const;

export const opacity = {
  pressed: 0.72,
  disabled: 0.55,
} as const;

export const shadows = {
  control: {
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  action: {
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  card: {
    boxShadow: "0 3px 4px rgba(0, 0, 0, 0.14)",
  },
} as const satisfies Record<string, ViewStyle>;
