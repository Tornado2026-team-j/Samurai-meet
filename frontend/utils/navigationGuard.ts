export type NavigationGuard = {
  begin: () => boolean;
  reset: () => void;
};

export function createNavigationGuard(): NavigationGuard {
  let inFlight = false;
  return {
    begin: () => {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    reset: () => {
      inFlight = false;
    },
  };
}
