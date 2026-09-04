import type { TextStyle, ViewStyle } from "react-native";

export type ColorScheme = "light" | "dark";

export type ThemeColors = {
  brand: {
    sky: string;
    gold: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    subtle: string;
    inverse: string;
    black: string;
    onSky: string;
    onGold: string;
  };
  surface: {
    screen: string;
    default: string;
    subtle: string;
    raised: string;
    blueSoft: string;
    goldSoft: string;
    warningSoft: string;
    dangerSoft: string;
    successSoft: string;
  };
  border: {
    default: string;
    subtle: string;
    muted: string;
    blue: string;
    blueStrong: string;
    gold: string;
    danger: string;
    dangerStrong: string;
  };
  state: {
    danger: string;
    dangerDark: string;
    warning: string;
    link: string;
    success: string;
  };
  overlay: {
    scrim: string;
    sheet: string;
  };
};

const lightColors: ThemeColors = {
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
    onSky: "#10212b",
    onGold: "#3a2a00",
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
};

const darkColors: ThemeColors = {
  brand: {
    sky: "#5ec5f5",
    gold: "#f0c66f",
  },
  text: {
    primary: "#f8fbfd",
    secondary: "#e8f0f5",
    muted: "#c7d5dd",
    subtle: "#b1c1cb",
    inverse: "#ffffff",
    black: "#101318",
    onSky: "#10212b",
    onGold: "#3a2a00",
  },
  surface: {
    screen: "#223543",
    default: "#2a4050",
    subtle: "#334b5a",
    raised: "#304756",
    blueSoft: "#255a73",
    goldSoft: "#5b4924",
    warningSoft: "#594c24",
    dangerSoft: "#5d3533",
    successSoft: "#2d5945",
  },
  border: {
    default: "#607987",
    subtle: "#506a79",
    muted: "#9fb3bf",
    blue: "#4e9fc0",
    blueStrong: "#6db7d4",
    gold: "#c49e50",
    danger: "#b8685c",
    dangerStrong: "#ff7166",
  },
  state: {
    danger: "#ff8175",
    dangerDark: "#ffad9d",
    warning: "#f3d273",
    link: "#78d0f6",
    success: "#80d9a2",
  },
  overlay: {
    scrim: "rgba(0, 0, 0, 0.65)",
    sheet: "rgba(7, 12, 17, 0.78)",
  },
};

// Kept for screens that have not migrated to useTheme yet. New themed code
// should use the palette returned by getThemeColors instead.
export const colors = lightColors;

export function getThemeColors(scheme: ColorScheme): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

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
    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.14)",
  },
  action: {
    boxShadow: "0 2px 3px rgba(0, 0, 0, 0.16)",
  },
  card: {
    boxShadow: "0 2px 3px rgba(0, 0, 0, 0.10)",
  },
} as const satisfies Record<string, ViewStyle>;
