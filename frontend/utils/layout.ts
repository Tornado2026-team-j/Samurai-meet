export const GLASS_TAB_BAR_HEIGHT = 68;

/**
 * Leaves enough scrollable room for the global floating tab bar and the
 * device safe area, so the last card can always be brought above the bar.
 */
export function getTabBarContentBottomPadding(bottomInset: number): number {
  const safeBottomInset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  return Math.max(safeBottomInset + GLASS_TAB_BAR_HEIGHT + 56, 156);
}
