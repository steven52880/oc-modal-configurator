export const MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;
export const VARIANT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const TEXT_VERBOSITY = ["low", "medium", "high"] as const;
export const INTERLEAVED_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;
export const NPM_PRESETS = [
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
] as const;

export const PROVIDER_COLUMN_IDS = ["name", "key", "npm", "baseURL"] as const;
export const MODEL_COLUMN_IDS = [
  "key",
  "context",
  "output",
  "inputModalities",
  "outputModalities",
  "variants",
  "npm",
] as const;
/** opencode 未配置 npm 时使用的默认驱动包 */
export const DEFAULT_NPM = "@ai-sdk/openai-compatible";
/** 模型级「协议」可选项（空字符串 = 继承提供商） */
export const MODEL_NPM_OPTIONS = [
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/google",
  "@ai-sdk/xai",
] as const;

/** File mtime in nanoseconds. Keep it as a string; a JS number cannot hold it. */
export type MtimeNs = string | null;

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  python: string;
  storage: "settings-file";
  settingsPath: string;
  catalogCachePath: string | null;
  defaultConfigPath: string;
  ccswitchDbPath: string;
}

export const CONFIG_SOURCES = ["opencode", "ccswitch"] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

export interface Settings {
  version: number;
  window: { width: number; height: number; x: number | null; y: number | null };
  splitRatio: number;
  activePage: string;
  providerColumns: Record<string, number>;
  modelColumns: Record<string, number>;
  lastConfigPath: string | null;
  recentConfigPaths: string[];
  configSource: ConfigSource;
}

export interface HeaderMap {
  [name: string]: string | number | boolean | null;
}

export interface ProviderOptions {
  baseURL: string | null;
  apiKey: string | null;
  setCacheKey: boolean | null;
  timeout: number | false | null;
  headerTimeout: number | false | null;
  chunkTimeout: number | false | null;
  headers: HeaderMap;
}

export interface ModelLimit {
  context: number | null;
  output: number | null;
  input: number | null;
  extra: Record<string, unknown>;
}

export interface ModelCost {
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  extra: Record<string, unknown>;
}

export interface ModelModalities {
  input: string[];
  output: string[];
}

export interface ModelProviderOverride {
  npm: string | null;
  api: string | null;
  extra: Record<string, unknown>;
}

export interface ModelMeta {
  family: string | null;
  release_date: string | null;
  status: string | null;
}

export interface ModelEntry {
  key: string;
  name: string | null;
  id: string | null;
  attachment: boolean | null;
  tool_call: boolean | null;
  reasoning: boolean | null;
  temperature: boolean | null;
  /** null unset, boolean, or a stream field name. Saved as `{ field }` when it is a string. */
  interleaved: boolean | string | null;
  limit: ModelLimit;
  /** null means the file had no modalities object. Empty arrays are omitted on save. */
  modalities: ModelModalities | null;
  variants: Record<string, Record<string, unknown>>;
  cost: ModelCost;
  options: Record<string, unknown>;
  headers: HeaderMap;
  provider: ModelProviderOverride;
  meta: ModelMeta;
  extra: Record<string, unknown>;
}

export interface ProviderEntry {
  key: string;
  name: string | null;
  npm: string | null;
  options: ProviderOptions;
  optionsExtra: Record<string, unknown>;
  extra: Record<string, unknown>;
  models: ModelEntry[];
}

export interface LockedProvider {
  key: string;
  name: string;
  reason: string;
}

export interface ConfigDocument {
  /** Which backend owns this document. The save call is routed by it. */
  source?: ConfigSource;
  /** opencode.json path, or the cc-switch.db path for the ccswitch source. */
  path: string;
  exists: boolean;
  /** File mtime for opencode; an opaque fingerprint for ccswitch. */
  mtimeNs: MtimeNs;
  /** Top-level opencode.json fields other than provider. Pass this through unchanged. */
  preserved: Record<string, unknown>;
  providers: ProviderEntry[];
  /** ccswitch only: the opencode.json kept in sync on save. */
  livePath?: string | null;
  /** ccswitch only: rows shown nowhere and never modified (OMO, V2 native, unreadable). */
  lockedProviders?: LockedProvider[];
  /** ccswitch only: providers loaded from opencode.json because it differs from the database. */
  driftedProviders?: string[];
  notices?: string[];
  running?: boolean;
  schemaVersion?: number;
}

export interface SaveResult {
  path: string;
  backupPath: string | null;
  mtimeNs: string;
  livePath?: string | null;
  liveBackupPath?: string | null;
}

export interface MetadataSourceInfo {
  id: string;
  sourceUrl: string | null;
  active: boolean;
}

export interface MetadataStatus {
  sourceId: string;
  sourceUrl: string;
  path: string;
  origin: "empty" | "cache" | "invalid";
  updatedAt: string | null;
  bytes: number;
  message: string | null;
  providerCount: number;
  modelCount: number;
  available: boolean;
  sources: MetadataSourceInfo[];
  activeSourceId: string;
}

export interface ModelDefaults {
  found: boolean;
  modelKey: string;
  providerHint: string | null;
  sourceId: string | null;
  matchedProviderId: string | null;
  matchedModelId: string | null;
  matchKind: "provider" | "exact" | "canonical" | "none";
  name: string | null;
  limit: { context: number | null; output: number | null; input: number | null };
  modalities: ModelModalities;
  variants: Record<string, Record<string, unknown>>;
  capabilities: {
    attachment: boolean | null;
    tool_call: boolean | null;
    reasoning: boolean | null;
    temperature: boolean | null;
  };
  cost: { input: number | null; output: number | null; cache_read: number | null; cache_write: number | null };
  meta: Partial<ModelMeta>;
  interleaved: boolean | string | null;
  reasoningEffortValues: string[];
  catalogNpm: string | null;
}

/** backend/param_templates.py 的生成结果；null 表示不改动，remove 列出需删除的字段 */
export interface ModelParamResult {
  modelKey: string;
  npm: string;
  status: "ok" | "unmatched" | "unsupported_npm";
  matchedProviderId: string | null;
  matchedModelId: string | null;
  variants: Record<string, Record<string, unknown>> | null;
  interleaved: boolean | string | null;
  temperature: boolean | null;
  remove: Array<"interleaved">;
  notes: string[];
}

export interface ModelParamRequest {
  modelKey: string;
  modelId?: string | null;
  providerHint?: string | null;
  npm?: string | null;
}

export interface CatalogModel extends ModelDefaults {
  id: string;
  providerId: string;
}

export interface CatalogGroup {
  prefix: string;
  models: CatalogModel[];
}

export interface CatalogProvider {
  id: string;
  name: string;
  npm: string | null;
  modelCount: number;
  sourceId: string;
}

export interface CatalogResult {
  available: boolean;
  groups: CatalogGroup[];
  providers: CatalogProvider[];
  total: number;
  truncated: boolean;
  hint: "catalog_empty" | "need_query" | null;
}

export interface RemoteModel {
  id: string;
  name: string | null;
  ownedBy: string | null;
  defaults: ModelDefaults | null;
}

export interface ProbeResult {
  source: "remote";
  url: string;
  models: Array<{ id: string; name: string | null; ownedBy: string | null }>;
  groups: Array<{ prefix: string; models: RemoteModel[] }>;
}

export interface ApiKeyInfo {
  kind: "empty" | "env" | "file" | "literal";
  name: string;
  resolvable: boolean;
}
