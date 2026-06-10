/**
 * usePWAInstall
 *
 * Captures the browser's `beforeinstallprompt` event so we can show our own
 * install UI instead of the default browser banner.
 *
 * Returns:
 *   isInstallable  — true when the prompt is available (Chrome/Edge/Android)
 *   isIOS         — true when running on iOS Safari (no beforeinstallprompt;
 *                   we show a manual "Add to Home Screen" hint instead)
 *   isStandalone  — true when already installed / running in standalone mode
 *   installPrompt — call this to trigger the native install dialog
 *   dismiss       — hides the banner for the session
 */
import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

function isStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed]           = useState(false);
  const [installed, setInstalled]           = useState(false);

  const standalone = isStandaloneMode();
  const ios        = isIOSSafari();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault(); // suppress default mini-infobar
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    const handler = () => setInstalled(true);
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, []);

  const installPrompt = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    /** True when the native install dialog is available (Chrome/Edge/Android) */
    isInstallable: !!deferredPrompt && !dismissed && !installed && !standalone,
    /** True on iOS Safari — show manual "Add to Home Screen" instructions */
    isIOS: ios && !standalone && !dismissed && !installed,
    isStandalone: standalone,
    installPrompt,
    dismiss,
  };
}
