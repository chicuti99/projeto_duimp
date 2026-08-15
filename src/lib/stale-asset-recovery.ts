const RELOAD_MARKER_KEY = "classifica-ncm:stale-asset-reload-at";
const RELOAD_COOLDOWN_MS = 60_000;

function shouldTreatAsStaleAsset(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Unable to preload CSS") ||
    message.includes("error loading dynamically imported module")
  );
}

function reloadOnceForFreshAssets() {
  const previousReloadAt = Number(
    window.sessionStorage.getItem(RELOAD_MARKER_KEY) ?? "0",
  );

  if (Date.now() - previousReloadAt < RELOAD_COOLDOWN_MS) {
    return;
  }

  window.sessionStorage.setItem(RELOAD_MARKER_KEY, String(Date.now()));
  window.location.reload();
}

export function installStaleAssetRecovery() {
  if (typeof window === "undefined") return;

  const globalWindow = window as Window & {
    __classificaNcmStaleAssetRecoveryInstalled?: boolean;
  };

  if (globalWindow.__classificaNcmStaleAssetRecoveryInstalled) return;
  globalWindow.__classificaNcmStaleAssetRecoveryInstalled = true;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForFreshAssets();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (!shouldTreatAsStaleAsset(event.reason)) return;

    event.preventDefault();
    reloadOnceForFreshAssets();
  });
}
