import { useCallback, useEffect, useState, type ReactNode } from "react";
import { loadAISettings, saveAISettings, type AISettings } from "../lib/ai/provider";
import { makeProvider } from "../lib/ai/factory";
import { listModelsFor } from "../lib/ai/models";

interface Props {
  onClose: () => void;
}

export function AISettingsDrawer({ onClose }: Props) {
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings());
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const update = <K extends keyof AISettings>(key: K, value: AISettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const onSave = () => {
    saveAISettings(settings);
    onClose();
  };

  const onTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const provider = makeProvider(settings);
      if (!provider) {
        setTestStatus("Provider is set to None.");
        return;
      }
      const ready = await provider.isReady();
      setTestStatus(
        ready
          ? `OK — ${provider.label} is reachable.`
          : `Provider not ready — check API key / server URL.`
      );
    } catch (e) {
      setTestStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI provider settings"
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">AI Provider Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Provider</label>
            <select
              value={settings.providerId}
              onChange={(e) => update("providerId", e.target.value as AISettings["providerId"])}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
            >
              <option value="none">None (offline only)</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (local)</option>
              <option value="llamacpp">llama.cpp / LM Studio (OpenAI-compatible, local)</option>
            </select>
          </div>

          {settings.providerId === "openai" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">API Key</label>
                <input
                  type="password"
                  value={settings.openaiApiKey ?? ""}
                  onChange={(e) => update("openaiApiKey", e.target.value)}
                  placeholder="sk-…"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
                />
                <p className="mt-1 text-xs text-zinc-500">Stored in your browser&apos;s localStorage. Never sent to anyone but OpenAI.</p>
              </div>
              <ModelPicker
                label="Model"
                value={settings.openaiModel ?? "gpt-4o-mini"}
                onChange={(v) => update("openaiModel", v)}
                fetcher={() => listModelsFor(settings)}
                deps={[settings.openaiApiKey ?? ""]}
                fallback="gpt-4o-mini"
              />
            </>
          )}

          {settings.providerId === "ollama" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Base URL</label>
                <input
                  value={settings.ollamaBaseUrl ?? "http://localhost:11434"}
                  onChange={(e) => update("ollamaBaseUrl", e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
                />
              </div>
              <ModelPicker
                label="Model"
                value={settings.ollamaModel ?? "llama3.1:8b"}
                onChange={(v) => update("ollamaModel", v)}
                fetcher={() => listModelsFor(settings)}
                deps={[settings.ollamaBaseUrl ?? ""]}
                fallback="llama3.1:8b"
                hint={<>Run <code>ollama serve</code> locally and <code>ollama pull &lt;name&gt;</code> to add models.</>}
              />
            </>
          )}

          {settings.providerId === "llamacpp" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Base URL</label>
                <input
                  value={settings.llamaCppBaseUrl ?? "http://localhost:8080"}
                  onChange={(e) => update("llamaCppBaseUrl", e.target.value)}
                  placeholder="http://localhost:8080 (llama.cpp) or http://localhost:1234 (LM Studio)"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Enter the server root only (e.g. <code>http://localhost:1234</code>). A trailing <code>/v1</code> is stripped automatically.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">API Key (optional)</label>
                <input
                  type="password"
                  value={settings.llamaCppApiKey ?? ""}
                  onChange={(e) => update("llamaCppApiKey", e.target.value)}
                  placeholder="(blank for unauthenticated local servers)"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
                />
              </div>
              <ModelPicker
                label="Model"
                value={settings.llamaCppModel ?? "local"}
                onChange={(v) => update("llamaCppModel", v)}
                fetcher={() => listModelsFor(settings)}
                deps={[settings.llamaCppBaseUrl ?? "", settings.llamaCppApiKey ?? ""]}
                fallback="local"
                hint={
                  <>
                    Works with any OpenAI-compatible local server: <code>llama-server -m model.gguf --port 8080</code>,
                    LM Studio (default port <code>1234</code>; <strong>enable CORS</strong> in Developer → Server),
                    or text-generation-webui. Endpoint: <code>/v1/chat/completions</code>.
                  </>
                }
              />
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onTest}
              disabled={testing || settings.providerId === "none"}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            <button
              onClick={onSave}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-medium hover:bg-teal-500"
            >
              Save
            </button>
          </div>

          {testStatus && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-300">
              {testStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ModelPickerProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fetcher: () => Promise<string[]>;
  deps: unknown[];
  fallback: string;
  hint?: ReactNode;
}

function ModelPicker({ label, value, onChange, fetcher, deps, fallback, hint }: ModelPickerProps) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetcher();
      setModels(list);
      if (list.length === 0) setError("No models found.");
      else if (!list.includes(value) && !manual) onChange(list[0] ?? fallback);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showManual = manual || models.length === 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-zinc-400">{label}</label>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            onClick={refresh}
            disabled={loading}
            className="text-teal-400 hover:text-teal-300 disabled:opacity-50"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
          <button
            onClick={() => setManual((m) => !m)}
            className="text-zinc-500 hover:text-zinc-300"
          >
            {showManual ? "Pick from list" : "Custom…"}
          </button>
        </div>
      </div>
      {showManual ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
        />
      ) : (
        <select
          value={models.includes(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
        >
          {!models.includes(value) && <option value="">— select model —</option>}
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      )}
      {error && <p className="mt-1 text-[11px] text-amber-400">{error} — use Custom… to enter manually.</p>}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
