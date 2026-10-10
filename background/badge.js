const BADGE_COLOR = '#d93025';

export async function updateBadge(tabId, tabCounts, settings) {
  const show = settings.uiMode === 'advanced' || settings.badgeInSimpleMode;
  const n = tabCounts.failed + tabCounts.errors;
  const text = show && n > 0 ? (n > 99 ? '99+' : String(n)) : '';
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // tab may be gone
  }
}
