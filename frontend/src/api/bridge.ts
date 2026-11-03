import type {
  ApiKeyInfo,
  AppInfo,
  CatalogResult,
  ConfigDocument,
  Envelope,
  MetadataStatus,
  ModelDefaults,
  ModelParamRequest,
  ModelParamResult,
  ProbeResult,
  SaveResult,
  Settings,
} from "../types/domain";

export class BridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

type PyApi = Record<string, (...args: unknown[]) => Promise<Envelope<unknown>>>;

function desktopApi(): PyApi | null {
  return window.pywebview?.api ?? null;
}

function whenDesktopReady(): Promise<void> {
  if (desktopApi() || location.port === "5173") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new BridgeError("bridge_unavailable", "桌面桥未就绪"));
    }, 5000);
    window.addEventListener(
      "pywebviewready",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function call<T>(method: string, args: unknown[]): Promise<T> {
  if (location.port !== "5173") await whenDesktopReady();
  const api = desktopApi();
  const envelope = api
    ? ((await api[method](...args)) as Envelope<T>)
    : await fetch(`/api/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      }).then(async (response) => (await response.json()) as Envelope<T>);
  if (!envelope.ok || envelope.data === undefined) {
    throw new BridgeError(envelope.error?.code ?? "internal", envelope.error?.message ?? "请求失败");
  }
  return envelope.data;
}

export const bridge = {
  getAppInfo: () => call<AppInfo>("get_app_info", []),
  loadConfig: (path?: string | null) => call<ConfigDocument>("load_config", [path ?? null]),
  loadCcswitch: () => call<ConfigDocument>("load_ccswitch", []),
  acceptCcswitchSchema: () => call<Settings>("accept_ccswitch_schema", []),
  saveConfig: (document: ConfigDocument, force = false) =>
    call<SaveResult>("save_config", [document, force]),
  pickConfigFile: () => call<{ path: string } | null>("pick_config_file", []),
  getMetadataStatus: () => call<MetadataStatus>("get_metadata_status", []),
  refreshMetadata: (sourceId?: string | null) =>
    call<MetadataStatus>("refresh_metadata", [sourceId ?? null]),
  clearMetadataCache: () => call<MetadataStatus>("clear_metadata_cache", []),
  reloadMetadataCache: () => call<MetadataStatus>("reload_metadata_cache", []),
  matchModelDefaults: (modelKey: string, providerHint?: string | null) =>
    call<ModelDefaults>("match_model_defaults", [modelKey, providerHint ?? null]),
  matchModelsDefaults: (items: Array<{ modelKey: string; providerHint?: string | null }>) =>
    call<ModelDefaults[]>("match_models_defaults", [items]),
  generateModelParams: (items: ModelParamRequest[]) =>
    call<ModelParamResult[]>("generate_model_params", [items]),
  probeProviderModels: (baseURL: string, apiKey?: string | null, providerHint?: string | null) =>
    call<ProbeResult>("probe_provider_models", [baseURL, apiKey ?? null, providerHint ?? null]),
  searchCatalog: (providerId?: string | null, query?: string | null, includeAll = false) =>
    call<CatalogResult>("search_catalog", [providerId ?? null, query ?? null, includeAll]),
  describeApiKey: (apiKey?: string | null) => call<ApiKeyInfo>("describe_api_key", [apiKey ?? null]),
  getSettings: () => call<Settings>("get_settings", []),
  updateSettings: (patch: Partial<Settings>) => call<Settings>("update_settings", [patch]),
};
