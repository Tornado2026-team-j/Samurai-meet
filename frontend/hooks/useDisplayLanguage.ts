import { useEffect, useState } from "react";
import {
  getCachedLanguage,
  loadLanguage,
  subscribeLanguage,
  type AppLanguage,
} from "../services/onboarding";

/**
 * Resolves the saved language before rendering localized screen copy.
 *
 * A null value is intentional: callers should show a neutral inline loading
 * state instead of briefly rendering a guessed language and replacing it.
 */
export function useDisplayLanguage(): AppLanguage | null {
  const [language, setLanguage] = useState<AppLanguage | null>(() => getCachedLanguage());

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => {
      if (active) setLanguage(nextLanguage);
    });

    void loadLanguage().then((storedLanguage) => {
      if (active) setLanguage(storedLanguage);
    }).catch(() => {
      // Keep the neutral state. Guessing a language would create a visible
      // copy swap when storage becomes available later.
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return language;
}
