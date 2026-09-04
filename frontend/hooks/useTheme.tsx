import {
  Appearance,
  useColorScheme,
} from "react-native";
import {
  createContext,
  useMemo,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getThemeColors, type ColorScheme, type ThemeColors } from "../components/ui/tokens";
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../services/theme";

type ThemeContextValue = {
  colors: ThemeColors;
  isLoading: boolean;
  preference: ThemePreference;
  scheme: ColorScheme;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadThemePreference()
      .then((storedPreference) => {
        if (active) setPreferenceState(storedPreference);
      })
      .catch(() => {
        // Keep the safe default when secure storage is unavailable.
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // react-native-web exposes getColorScheme/addChangeListener but does not
    // implement the native setColorScheme API. The ThemeContext already owns
    // the rendered palette, so this native synchronization is optional on web.
    if (typeof Appearance.setColorScheme === "function") {
      Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
    }
  }, [preference]);

  const scheme: ColorScheme = preference === "system" ? systemScheme : preference;
  const colors = useMemo(() => getThemeColors(scheme), [scheme]);
  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    await saveThemePreference(nextPreference);
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    colors,
    isLoading,
    preference,
    scheme,
    setPreference,
  }), [colors, isLoading, preference, scheme, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export function useThemeStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
