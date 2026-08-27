import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "./useAuth";
import { listNotifications } from "../services/notifications";

export function useUnreadNotifications(): boolean {
  const { getCurrentSession, session, status } = useAuth();
  const [hasUnread, setHasUnread] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const activeSession = getCurrentSession() ?? session;
      if (status !== "signed_in" || !activeSession) {
        if (!cancelled) setHasUnread(false);
        return;
      }

      try {
        const notifications = await listNotifications(
          activeSession,
          { unreadOnly: true, limit: 1 },
          controller.signal,
        );
        if (!cancelled) setHasUnread(notifications.length > 0);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) setHasUnread(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getCurrentSession, session, status]);

  useFocusEffect(load);
  return hasUnread;
}
