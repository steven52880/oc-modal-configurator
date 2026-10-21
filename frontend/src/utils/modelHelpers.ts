import {
  MODALITIES,
  VARIANT_ORDER,
  type CatalogModel,
  type ModelDefaults,
  type ModelEntry,
  type ModelMeta,
  type ProviderEntry,
} from "../types/domain";

export const MIXED_PLACEHOLDER = "<...>";

const PREFIX_PALETTE: Array<{ bg: string; fg: string; border: string }> = [
  { bg: "#e0f2fe", fg: "#0369a1", border: "#bae6fd" },
  { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  { bg: "#f3e8ff", fg: "#6d28d9", border: "#e9d5ff" },
  { bg: "#ffe4e6", fg: "#be123c", border: "#fecdd3" },
  { bg: "#ccfbf1", fg: "#0f766e", border: "#99f6e4" },
  { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" },
];

/**
 * Matches backend/fields.py `model_prefix`:
 * Extracts the first hyphen segment after stripping path prefix and leading `~`.
 */
export function getModelPrefix(modelId: string): string {
  const leaf = (modelId.split("/").pop() ?? modelId).replace(/^~+/, "").trim();
  const prefix = leaf.split("-", 1)[0]?.trim() ?? "";
  return (prefix || leaf || modelId).toLowerCase();
}

export function getPrefixColor(prefix: string): { bg: string; fg: string; border: string } {
  let hash = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    hash = (hash * 31 + prefix.charCodeAt(i)) >>> 0;
  }
  return PREFIX_PALETTE[hash % PREFIX_PALETTE.length];
}

/**
 * Returns a view-only sorted copy of `models` (grouped by first hyphen segment, then sorted by key).
 * Never mutates the original `models` array.
 */
export function sortModelsForDisplay(models: ModelEntry[]): ModelEntry[] {
  return [...models].sort((a, b) => {
    const prefixA = getModelPrefix(a.key);
    const prefixB = getModelPrefix(b.key);
    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB);
    }
    return a.key.localeCompare(b.key);
  });
}

/**
 * Serializes a modality array into comma-separated tokens ordered by MODALITIES first,
 * followed by any unknown modality tokens.
 */
export function serializeModalities(items: string[] | null | undefined): string {
  if (!items || items.length === 0) return "";
  const set = new Set(items.map((item) => item.trim()).filter(Boolean));
  const known = MODALITIES.filter((mod) => set.has(mod));
  const unknown = items.filter(
    (item) => item.trim() && !MODALITIES.includes(item.trim() as (typeof MODALITIES)[number]),
  );
  return [...known, ...unknown].join(", ");
}

/**
 * Parses a comma-separated string for modalities while preserving any unknown tokens
 * if requested, or replacing with the parsed token list ordered by MODALITIES.
 */
export function parseModalitiesFromCell(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  const known = MODALITIES.filter((mod) => unique.includes(mod));
  const unknown = unique.filter(
    (item) => !MODALITIES.includes(item as (typeof MODALITIES)[number]),
  );
  return [...known, ...unknown];
}

/**
 * Toggles a single known modality checkbox while preserving any unknown modality tokens
 * already on the model.
 */
export function toggleKnownModality(
  current: string[] | null | undefined,
  modality: string,
  checked: boolean,
): string[] {
  const existing = current ?? [];
  const unknown = existing.filter(
    (item) => !MODALITIES.includes(item as (typeof MODALITIES)[number]),
  );
  const knownSet = new Set(
    existing.filter((item) => MODALITIES.includes(item as (typeof MODALITIES)[number])),
  );
  if (checked) {
    knownSet.add(modality);
  } else {
    knownSet.delete(modality);
  }
  const orderedKnown = MODALITIES.filter((mod) => knownSet.has(mod));
  return [...orderedKnown, ...unknown];
}

/**
 * Serializes variant keys into comma-separated tokens ordered by VARIANT_ORDER first,
 * followed by any custom variant keys.
 */
export function serializeVariants(
  variants: Record<string, Record<string, unknown>> | null | undefined,
): string {
  if (!variants) return "";
  const keys = Object.keys(variants);
  if (keys.length === 0) return "";
  const keySet = new Set(keys);
  const known = VARIANT_ORDER.filter((v) => keySet.has(v));
  const custom = keys.filter(
    (k) => !VARIANT_ORDER.includes(k as (typeof VARIANT_ORDER)[number]),
  );
  return [...known, ...custom].join(", ");
}

/**
 * Applies a comma-separated variant list from spreadsheet paste while preserving
 * existing variant config objects for keys that remain enabled.
 */
export function applyVariantsFromCell(
  existing: Record<string, Record<string, unknown>> | null | undefined,
  raw: string,
): Record<string, Record<string, unknown>> {
  const current = existing ?? {};
  const parts = Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
  const known = VARIANT_ORDER.filter((v) => parts.includes(v));
  const custom = parts.filter(
    (k) => !VARIANT_ORDER.includes(k as (typeof VARIANT_ORDER)[number]),
  );
  const next: Record<string, Record<string, unknown>> = {};
  for (const key of [...known, ...custom]) {
    next[key] = current[key] ? { ...current[key] } : {};
  }
  return next;
}

/**
 * Toggles a single variant checkbox: checking adds `{}` without wiping an existing object;
 * unchecking deletes the key. Orders keys according to VARIANT_ORDER.
 */
export function toggleVariantKey(
  existing: Record<string, Record<string, unknown>> | null | undefined,
  variantKey: string,
  checked: boolean,
): Record<string, Record<string, unknown>> {
  const current = { ...(existing ?? {}) };
  if (checked) {
    if (!current[variantKey]) {
      current[variantKey] = {};
    }
  } else {
    delete current[variantKey];
  }
  const keys = Object.keys(current);
  const known = VARIANT_ORDER.filter((k) => keys.includes(k));
  const custom = keys.filter(
    (k) => !VARIANT_ORDER.includes(k as (typeof VARIANT_ORDER)[number]),
  );
  const ordered: Record<string, Record<string, unknown>> = {};
  for (const key of [...known, ...custom]) {
    ordered[key] = current[key];
  }
  return ordered;
}

export function createEmptyMeta(partial?: Partial<ModelMeta> | null): ModelMeta {
  return {
    family: partial?.family ?? null,
    release_date: partial?.release_date ?? null,
    last_updated: partial?.last_updated ?? null,
    knowledge: partial?.knowledge ?? null,
    open_weights: partial?.open_weights ?? null,
    canonical_model_id: partial?.canonical_model_id ?? null,
    description: partial?.description ?? null,
    status: partial?.status ?? null,
  };
}

export function createEmptyProvider(existingKeys: string[]): ProviderEntry {
  let idx = existingKeys.length + 1;
  let candidate = `provider-${idx}`;
  const set = new Set(existingKeys);
  while (set.has(candidate)) {
    idx += 1;
    candidate = `provider-${idx}`;
  }
  return {
    key: candidate,
    name: `提供商 ${idx}`,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: null,
      apiKey: null,
      setCacheKey: null,
      timeout: null,
      headerTimeout: null,
      chunkTimeout: null,
      headers: {},
    },
    optionsExtra: {},
    extra: {},
    models: [],
  };
}

export function createEmptyModel(existingKeys: string[]): ModelEntry {
  let idx = existingKeys.length + 1;
  let candidate = `model-${idx}`;
  const set = new Set(existingKeys);
  while (set.has(candidate)) {
    idx += 1;
    candidate = `model-${idx}`;
  }
  return {
    key: candidate,
    name: null,
    id: null,
    attachment: null,
    tool_call: null,
    reasoning: null,
    temperature: null,
    interleaved: null,
    limit: {
      context: null,
      output: null,
      input: null,
      extra: {},
    },
    modalities: null,
    variants: {},
    cost: {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      extra: {},
    },
    options: {},
    headers: {},
    provider: {
      npm: null,
      api: null,
      extra: {},
    },
    meta: createEmptyMeta(),
    extra: {},
  };
}

/**
 * Builds a new ModelEntry from a remote probe item or catalog entry with matched defaults.
 */
export function createModelFromSource(
  id: string,
  fallbackName: string | null,
  defaults: ModelDefaults | CatalogModel | null,
): ModelEntry {
  const hasDefaults = Boolean(defaults && defaults.found);
  const inputMods = hasDefaults && defaults ? [...defaults.modalities.input] : [];
  const outputMods = hasDefaults && defaults ? [...defaults.modalities.output] : [];
  const hasModalities = inputMods.length > 0 || outputMods.length > 0;

  const variants: Record<string, Record<string, unknown>> = {};
  if (hasDefaults && defaults?.variants) {
    for (const [k, v] of Object.entries(defaults.variants)) {
      variants[k] = v && typeof v === "object" ? { ...v } : {};
    }
  }

  return {
    key: id,
    name: (hasDefaults && defaults?.name) || fallbackName || null,
    id: null,
    attachment: hasDefaults && defaults ? defaults.capabilities.attachment : null,
    tool_call: hasDefaults && defaults ? defaults.capabilities.tool_call : null,
    reasoning: hasDefaults && defaults ? defaults.capabilities.reasoning : null,
    temperature: hasDefaults && defaults ? defaults.capabilities.temperature : null,
    interleaved: hasDefaults && defaults ? defaults.interleaved : null,
    limit: {
      context: hasDefaults && defaults ? defaults.limit.context : null,
      output: hasDefaults && defaults ? defaults.limit.output : null,
      input: hasDefaults && defaults ? defaults.limit.input : null,
      extra: {},
    },
    modalities: hasModalities
      ? {
          input: inputMods,
          output: outputMods,
        }
      : null,
    variants,
    cost: {
      input: hasDefaults && defaults ? defaults.cost.input : null,
      output: hasDefaults && defaults ? defaults.cost.output : null,
      cache_read: hasDefaults && defaults ? defaults.cost.cache_read : null,
      cache_write: hasDefaults && defaults ? defaults.cost.cache_write : null,
      extra: {},
    },
    options: {},
    headers: {},
    provider: {
      npm: null,
      api: null,
      extra: {},
    },
    meta: createEmptyMeta(hasDefaults && defaults ? defaults.meta : null),
    extra: {},
  };
}

/**
 * Applies matched defaults to ONLY the specified model table columnIds.
 */
export function applyDefaultsToModelColumns(
  model: ModelEntry,
  columnIds: string[],
  defaults: ModelDefaults,
): ModelEntry {
  if (!defaults.found) return model;
  let next: ModelEntry = {
    ...model,
    limit: { ...model.limit, extra: { ...model.limit.extra } },
    modalities: model.modalities
      ? { input: [...model.modalities.input], output: [...model.modalities.output] }
      : null,
    variants: { ...model.variants },
  };

  for (const colId of columnIds) {
    if (colId === "context" && defaults.limit.context !== null) {
      next.limit.context = defaults.limit.context;
    } else if (colId === "output" && defaults.limit.output !== null) {
      next.limit.output = defaults.limit.output;
    } else if (colId === "inputModalities") {
      const existingUnknown = (next.modalities?.input ?? []).filter(
        (item) => !MODALITIES.includes(item as (typeof MODALITIES)[number]),
      );
      const nextInput = [...defaults.modalities.input, ...existingUnknown];
      const nextOutput = next.modalities?.output ?? [];
      next.modalities =
        nextInput.length > 0 || nextOutput.length > 0
          ? { input: nextInput, output: nextOutput }
          : null;
    } else if (colId === "outputModalities") {
      const existingUnknown = (next.modalities?.output ?? []).filter(
        (item) => !MODALITIES.includes(item as (typeof MODALITIES)[number]),
      );
      const nextInput = next.modalities?.input ?? [];
      const nextOutput = [...defaults.modalities.output, ...existingUnknown];
      next.modalities =
        nextInput.length > 0 || nextOutput.length > 0
          ? { input: nextInput, output: nextOutput }
          : null;
    } else if (colId === "variants") {
      const updatedVariants: Record<string, Record<string, unknown>> = {};
      for (const key of Object.keys(defaults.variants)) {
        updatedVariants[key] = next.variants[key]
          ? { ...next.variants[key] }
          : { ...(defaults.variants[key] ?? {}) };
      }
      next.variants = updatedVariants;
    }
  }

  return next;
}

export function formatNumberCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("en-US");
}

export type KnownModality = (typeof MODALITIES)[number];
export type KnownVariant = (typeof VARIANT_ORDER)[number];

export const MODALITY_META: Record<
  KnownModality,
  {
    label: string;
    zhName: string;
    activeColor: string;
    activeBg: string;
    activeBorder: string;
  }
> = {
  text: {
    label: "text",
    zhName: "文本",
    activeColor: "#1B61C9",
    activeBg: "rgba(27, 97, 201, 0.12)",
    activeBorder: "rgba(27, 97, 201, 0.35)",
  },
  image: {
    label: "image",
    zhName: "图像",
    activeColor: "#15803D",
    activeBg: "rgba(21, 128, 61, 0.12)",
    activeBorder: "rgba(21, 128, 61, 0.35)",
  },
  audio: {
    label: "audio",
    zhName: "音频",
    activeColor: "#7C3AED",
    activeBg: "rgba(124, 58, 237, 0.12)",
    activeBorder: "rgba(124, 58, 237, 0.35)",
  },
  video: {
    label: "video",
    zhName: "视频",
    activeColor: "#EA580C",
    activeBg: "rgba(234, 88, 12, 0.12)",
    activeBorder: "rgba(234, 88, 12, 0.35)",
  },
  pdf: {
    label: "pdf",
    zhName: "PDF 文档",
    activeColor: "#DC2626",
    activeBg: "rgba(220, 38, 38, 0.12)",
    activeBorder: "rgba(220, 38, 38, 0.35)",
  },
};

export const VARIANT_META: Record<
  KnownVariant,
  { shortLabel: string; tooltip: string }
> = {
  none: { shortLabel: "NONE", tooltip: "none (无推理)" },
  minimal: { shortLabel: "MIN", tooltip: "minimal (极简推理)" },
  low: { shortLabel: "LOW", tooltip: "low (低强度推理)" },
  medium: { shortLabel: "MED", tooltip: "medium (中等推理)" },
  high: { shortLabel: "HIGH", tooltip: "high (高强度推理)" },
  xhigh: { shortLabel: "XHIGH", tooltip: "xhigh (超高强度推理)" },
  max: { shortLabel: "MAX", tooltip: "max (最大强度推理)" },
};

export function splitCatalogPath(fullPath: string | null | undefined): {
  filePath: string;
  dirPath: string;
  fileName: string;
} {
  const raw = (fullPath ?? "").trim();
  if (!raw) {
    return {
      filePath: "api.json",
      dirPath: "(未获取到缓存目录)",
      fileName: "api.json",
    };
  }
  const lastSep = Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/"));
  if (lastSep <= 0) {
    return {
      filePath: raw,
      dirPath: ".",
      fileName: raw,
    };
  }
  return {
    filePath: raw,
    dirPath: raw.slice(0, lastSep),
    fileName: raw.slice(lastSep + 1) || "api.json",
  };
}

