import React, { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import { bridge } from "../api/bridge";
import {
  DEFAULT_NPM,
  INTERLEAVED_FIELDS,
  MODALITIES,
  MODEL_NPM_OPTIONS,
  REASONING_EFFORTS,
  TEXT_VERBOSITY,
  VARIANT_ORDER,
  type ModelDefaults,
  type ModelEntry,
} from "../types/domain";
import {
  KeyValueHeaderEditor,
  headerMapToRows,
  rowsToHeaderMap,
  type HeaderRow,
} from "./KeyValueHeaderEditor";
import {
  MIXED_PLACEHOLDER,
  MODALITY_META,
  displayNpm,
  normalizeNpmInput,
  VARIANT_META,
  type KnownModality,
} from "../utils/modelHelpers";
import { MONOSPACE_FONT } from "../theme";

type TriCheck = "checked" | "unchecked" | "mixed";
type CapState = "mixed" | "unset" | "true" | "false";

const MODALITY_ICONS: Record<KnownModality, React.ElementType> = {
  text: TextFieldsIcon,
  image: ImageOutlinedIcon,
  audio: GraphicEqIcon,
  video: VideocamOutlinedIcon,
  pdf: PictureAsPdfOutlinedIcon,
};

const CONTEXT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
  { label: "200K", value: 200000 },
  { label: "1M", value: 1048576 },
];

const OUTPUT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "4K", value: 4096 },
  { label: "8K", value: 8192 },
  { label: "16K", value: 16384 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
];

const CAPABILITY_ITEMS: Array<{
  key: "attachment" | "tool_call" | "reasoning" | "temperature";
  label: string;
}> = [
  { key: "attachment", label: "支持附件 (attachment)" },
  { key: "tool_call", label: "工具调用 (tool_call)" },
  { key: "reasoning", label: "推理模型 (reasoning)" },
  { key: "temperature", label: "温度调节 (temperature)" },
];

const COST_ITEMS: Array<{
  key: "input" | "output" | "cache_read" | "cache_write";
  label: string;
}> = [
  { key: "input", label: "输入价格 (cost.input)" },
  { key: "output", label: "输出价格 (cost.output)" },
  { key: "cache_read", label: "缓存读取 (cache_read)" },
  { key: "cache_write", label: "缓存写入 (cache_write)" },
];

function extractExtraOptions(options: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...(options ?? {}) };
  delete copy.reasoningEffort;
  delete copy.textVerbosity;
  if (copy.thinking && typeof copy.thinking === "object" && !Array.isArray(copy.thinking)) {
    const thinkingRest = { ...(copy.thinking as Record<string, unknown>) };
    delete thinkingRest.budgetTokens;
    if (Object.keys(thinkingRest).length > 0) {
      copy.thinking = thinkingRest;
    } else {
      delete copy.thinking;
    }
  }
  return copy;
}

function getBudgetTokens(options: Record<string, unknown>): number | null {
  const thinking = options?.thinking;
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
    const bt = (thinking as Record<string, unknown>).budgetTokens;
    if (typeof bt === "number" && Number.isFinite(bt)) return bt;
  }
  return null;
}

function serializeInterleavedSelect(val: boolean | string | null | undefined): string {
  if (val === null || val === undefined) return "";
  if (val === true) return "true";
  if (val === false) return "false";
  return String(val);
}

function deserializeInterleavedSelect(raw: string): boolean | string | null {
  if (!raw) return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

interface ModelEditSectionProps {
  targets: ModelEntry[];
  providerKey: string;
  /** 所属提供商的 npm，模型未覆盖时继承它 */
  providerNpm?: string | null;
  existingKeys: string[];
  isBatch: boolean;
  onSave: (updated: ModelEntry[]) => void;
  onCancel: () => void;
}

/** 协议下拉中「继承提供商」选项的显示文本（选中即清除覆盖） */
const NPM_INHERIT_LABEL = "(继承提供商)";

export const ModelEditSection: React.FC<ModelEditSectionProps> = ({
  targets,
  providerKey,
  providerNpm = null,
  existingKeys,
  isBatch,
  onSave,
  onCancel,
}) => {
  const first = targets[0];

  const isSame = <T,>(getter: (m: ModelEntry) => T): boolean => {
    const base = JSON.stringify(getter(first));
    return targets.every((item) => JSON.stringify(getter(item)) === base);
  };

  // Defaults from models.dev
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null);

  // Layer 2 — 1. key & name
  const [keyText, setKeyText] = useState<string>(first.key);
  const [nameMixed, setNameMixed] = useState<boolean>(() => isBatch && !isSame((m) => m.name ?? ""));
  const [nameText, setNameText] = useState<string>(() =>
    isBatch && !isSame((m) => m.name ?? "") ? "" : first.name ?? "",
  );

  // Layer 2 — 2. limit.context & limit.output
  const [contextMixed, setContextMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.limit.context),
  );
  const [contextText, setContextText] = useState<string>(() =>
    isBatch && !isSame((m) => m.limit.context)
      ? ""
      : first.limit.context !== null
        ? String(first.limit.context)
        : "",
  );

  const [outputMixed, setOutputMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.limit.output),
  );
  const [outputText, setOutputText] = useState<string>(() =>
    isBatch && !isSame((m) => m.limit.output)
      ? ""
      : first.limit.output !== null
        ? String(first.limit.output)
        : "",
  );

  // Layer 2 — 3 & 4. inputModalities & outputModalities (per-modality tri-state)
  const [inputModStates, setInputModStates] = useState<Record<string, TriCheck>>(() => {
    const map: Record<string, TriCheck> = {};
    for (const mod of MODALITIES) {
      const checks = targets.map((m) => Boolean(m.modalities?.input?.includes(mod)));
      const allTrue = checks.every(Boolean);
      const allFalse = checks.every((c) => !c);
      map[mod] = allTrue ? "checked" : allFalse ? "unchecked" : "mixed";
    }
    return map;
  });

  const [outputModStates, setOutputModStates] = useState<Record<string, TriCheck>>(() => {
    const map: Record<string, TriCheck> = {};
    for (const mod of MODALITIES) {
      const checks = targets.map((m) => Boolean(m.modalities?.output?.includes(mod)));
      const allTrue = checks.every(Boolean);
      const allFalse = checks.every((c) => !c);
      map[mod] = allTrue ? "checked" : allFalse ? "unchecked" : "mixed";
    }
    return map;
  });

  // Layer 2 — 5. variants (per-variant tri-state + custom JSON)
  const [variantStates, setVariantStates] = useState<Record<string, TriCheck>>(() => {
    const map: Record<string, TriCheck> = {};
    for (const vKey of VARIANT_ORDER) {
      const checks = targets.map((m) => Boolean(m.variants && vKey in m.variants));
      const allTrue = checks.every(Boolean);
      const allFalse = checks.every((c) => !c);
      map[vKey] = allTrue ? "checked" : allFalse ? "unchecked" : "mixed";
    }
    return map;
  });

  // Layer 2 — 6. Capabilities
  const [capStates, setCapStates] = useState<
    Record<"attachment" | "tool_call" | "reasoning" | "temperature", CapState>
  >(() => {
    const initCap = (key: "attachment" | "tool_call" | "reasoning" | "temperature"): CapState => {
      if (isBatch && !isSame((m) => m[key])) return "mixed";
      if (first[key] === true) return "true";
      if (first[key] === false) return "false";
      return "unset";
    };
    return {
      attachment: initCap("attachment"),
      tool_call: initCap("tool_call"),
      reasoning: initCap("reasoning"),
      temperature: initCap("temperature"),
    };
  });

  // Layer 3 — Accordion 1: Reasoning & Thinking
  const [reasoningEffortVal, setReasoningEffortVal] = useState<string>(() => {
    if (isBatch && !isSame((m) => m.options?.reasoningEffort ?? null)) return "__MIXED__";
    const v = first.options?.reasoningEffort;
    return typeof v === "string" ? v : "";
  });

  const [textVerbosityVal, setTextVerbosityVal] = useState<string>(() => {
    if (isBatch && !isSame((m) => m.options?.textVerbosity ?? null)) return "__MIXED__";
    const v = first.options?.textVerbosity;
    return typeof v === "string" ? v : "";
  });

  const [interleavedVal, setInterleavedVal] = useState<string>(() => {
    if (isBatch && !isSame((m) => m.interleaved)) return "__MIXED__";
    return serializeInterleavedSelect(first.interleaved);
  });

  const [budgetMixed, setBudgetMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => getBudgetTokens(m.options)),
  );
  const [budgetText, setBudgetText] = useState<string>(() => {
    if (isBatch && !isSame((m) => getBudgetTokens(m.options))) return "";
    const bt = getBudgetTokens(first.options);
    return bt !== null ? String(bt) : "";
  });

  // Layer 3 — Accordion 2: limit.input & cost
  const [limitInputMixed, setLimitInputMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.limit.input),
  );
  const [limitInputText, setLimitInputText] = useState<string>(() =>
    isBatch && !isSame((m) => m.limit.input)
      ? ""
      : first.limit.input !== null
        ? String(first.limit.input)
        : "",
  );

  const [costMixed, setCostMixed] = useState<
    Record<"input" | "output" | "cache_read" | "cache_write", boolean>
  >(() => ({
    input: isBatch && !isSame((m) => m.cost.input),
    output: isBatch && !isSame((m) => m.cost.output),
    cache_read: isBatch && !isSame((m) => m.cost.cache_read),
    cache_write: isBatch && !isSame((m) => m.cost.cache_write),
  }));

  const [costText, setCostText] = useState<
    Record<"input" | "output" | "cache_read" | "cache_write", string>
  >(() => ({
    input:
      isBatch && !isSame((m) => m.cost.input)
        ? ""
        : first.cost.input !== null
          ? String(first.cost.input)
          : "",
    output:
      isBatch && !isSame((m) => m.cost.output)
        ? ""
        : first.cost.output !== null
          ? String(first.cost.output)
          : "",
    cache_read:
      isBatch && !isSame((m) => m.cost.cache_read)
        ? ""
        : first.cost.cache_read !== null
          ? String(first.cost.cache_read)
          : "",
    cache_write:
      isBatch && !isSame((m) => m.cost.cache_write)
        ? ""
        : first.cost.cache_write !== null
          ? String(first.cost.cache_write)
          : "",
  }));

  // Layer 3 — Accordion 3: Driver override, headers, options JSON, variants JSON
  const [providerNpmMixed, setProviderNpmMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.provider.npm ?? ""),
  );
  const [providerNpmText, setProviderNpmText] = useState<string>(() =>
    // 输入框内显示短名，保存时由 normalizeNpmInput 补全为完整包名
    isBatch && !isSame((m) => m.provider.npm ?? "") ? "" : displayNpm(first.provider.npm),
  );

  const [providerApiMixed, setProviderApiMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.provider.api ?? ""),
  );
  const [providerApiText, setProviderApiText] = useState<string>(() =>
    isBatch && !isSame((m) => m.provider.api ?? "") ? "" : first.provider.api ?? "",
  );

  const [idMixed, setIdMixed] = useState<boolean>(() => isBatch && !isSame((m) => m.id ?? ""));
  const [idText, setIdText] = useState<string>(() =>
    isBatch && !isSame((m) => m.id ?? "") ? "" : first.id ?? "",
  );

  const [headersMixed, setHeadersMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => m.headers),
  );
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() =>
    isBatch && !isSame((m) => m.headers) ? [] : headerMapToRows(first.headers),
  );

  const [extraOptionsMixed, setExtraOptionsMixed] = useState<boolean>(
    () => isBatch && !isSame((m) => extractExtraOptions(m.options)),
  );
  const [extraOptionsText, setExtraOptionsText] = useState<string>(() => {
    if (isBatch && !isSame((m) => extractExtraOptions(m.options))) return "";
    const extra = extractExtraOptions(first.options);
    return Object.keys(extra).length > 0 ? JSON.stringify(extra, null, 2) : "";
  });

  const [variantsJsonEdited, setVariantsJsonEdited] = useState<boolean>(false);
  const [variantsJsonText, setVariantsJsonText] = useState<string>(() => {
    if (isBatch && !isSame((m) => m.variants)) return "";
    const hasCustomProps = Object.values(first.variants ?? {}).some(
      (v) => v && Object.keys(v).length > 0,
    );
    return hasCustomProps ? JSON.stringify(first.variants, null, 2) : "";
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Match defaults via bridge
  useEffect(() => {
    let cancelled = false;
    if (!isBatch) {
      const queryKey = keyText.trim() || first.key;
      bridge
        .matchModelDefaults(queryKey, providerKey)
        .then((res) => {
          if (!cancelled) setDefaults(res.found ? res : null);
        })
        .catch(() => {
          if (!cancelled) setDefaults(null);
        });
    } else {
      bridge
        .matchModelsDefaults(
          targets.map((t) => ({ modelKey: t.key, providerHint: providerKey })),
        )
        .then((list) => {
          if (cancelled) return;
          const matched = list.find((d) => d.found) ?? null;
          setDefaults(matched);
        })
        .catch(() => {
          if (!cancelled) setDefaults(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isBatch, keyText, first.key, providerKey, targets]);

  // Layer 4 Read-Only Meta items
  const metaChips = useMemo(() => {
    const items: string[] = [];
    const metaSource = {
      ...(defaults?.meta ?? {}),
      ...Object.fromEntries(
        Object.entries(first.meta ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ""),
      ),
    };
    if (metaSource.family) items.push(`家族: ${metaSource.family}`);
    if (metaSource.release_date) items.push(`发布: ${metaSource.release_date}`);
    if (metaSource.status) items.push(`状态: ${metaSource.status}`);
    return items;
  }, [first.meta, defaults]);

  // Layer 3 Accordion Active Counts
  const reasoningAccordionCount = useMemo(() => {
    let count = 0;
    if (reasoningEffortVal && reasoningEffortVal !== "__MIXED__") count += 1;
    else if (reasoningEffortVal === "__MIXED__" && targets.some((m) => m.options?.reasoningEffort))
      count += 1;

    if (textVerbosityVal && textVerbosityVal !== "__MIXED__") count += 1;
    else if (textVerbosityVal === "__MIXED__" && targets.some((m) => m.options?.textVerbosity))
      count += 1;

    if (interleavedVal && interleavedVal !== "__MIXED__") count += 1;
    else if (interleavedVal === "__MIXED__" && targets.some((m) => m.interleaved !== null))
      count += 1;

    if (!budgetMixed && budgetText.trim() !== "") count += 1;
    else if (budgetMixed && targets.some((m) => getBudgetTokens(m.options) !== null)) count += 1;

    return count;
  }, [reasoningEffortVal, textVerbosityVal, interleavedVal, budgetMixed, budgetText, targets]);

  const costAccordionCount = useMemo(() => {
    let count = 0;
    if (!limitInputMixed && limitInputText.trim() !== "") count += 1;
    else if (limitInputMixed && targets.some((m) => m.limit.input !== null)) count += 1;

    for (const k of ["input", "output", "cache_read", "cache_write"] as const) {
      if (!costMixed[k] && costText[k].trim() !== "") count += 1;
      else if (costMixed[k] && targets.some((m) => m.cost[k] !== null)) count += 1;
    }
    return count;
  }, [limitInputMixed, limitInputText, costMixed, costText, targets]);

  const advancedAccordionCount = useMemo(() => {
    let count = 0;
    if (!providerApiMixed && providerApiText.trim() !== "") count += 1;
    if (!idMixed && idText.trim() !== "") count += 1;
    if (!headersMixed) count += headerRows.filter((r) => r.name.trim() !== "").length;
    if (!extraOptionsMixed && extraOptionsText.trim() !== "") count += 1;
    if (variantsJsonText.trim() !== "") count += 1;
    return count;
  }, [
    providerApiMixed,
    providerApiText,
    idMixed,
    idText,
    headersMixed,
    headerRows,
    extraOptionsMixed,
    extraOptionsText,
    variantsJsonText,
  ]);

  const parseNumberField = (
    text: string,
    label: string,
  ): { value: number | null; error?: string } => {
    const trimmed = text.trim().replace(/,/g, "");
    if (!trimmed) return { value: null };
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) {
      return { value: null, error: `${label} 必须是非负有效数字` };
    }
    return { value: num };
  };

  const handleConfirm = () => {
    setErrorMessage(null);
    const trimmedKey = keyText.trim();
    if (!isBatch) {
      if (!trimmedKey) {
        setErrorMessage("模型标识符不能为空");
        return;
      }
      if (trimmedKey !== first.key && existingKeys.includes(trimmedKey)) {
        setErrorMessage(`模型标识符「${trimmedKey}」在当前提供商下已存在`);
        return;
      }
    }

    const ctxParsed = contextMixed
      ? { value: null }
      : parseNumberField(contextText, "上下文长度");
    if (ctxParsed.error) {
      setErrorMessage(ctxParsed.error);
      return;
    }

    const outParsed = outputMixed ? { value: null } : parseNumberField(outputText, "输出长度");
    if (outParsed.error) {
      setErrorMessage(outParsed.error);
      return;
    }

    const limInParsed = limitInputMixed
      ? { value: null }
      : parseNumberField(limitInputText, "最大输入限制");
    if (limInParsed.error) {
      setErrorMessage(limInParsed.error);
      return;
    }

    const budgetParsed = budgetMixed
      ? { value: null }
      : parseNumberField(budgetText, "思考预算 (budgetTokens)");
    if (budgetParsed.error) {
      setErrorMessage(budgetParsed.error);
      return;
    }

    const parsedCosts: Record<"input" | "output" | "cache_read" | "cache_write", number | null> = {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
    };
    for (const item of COST_ITEMS) {
      if (!costMixed[item.key]) {
        const res = parseNumberField(costText[item.key], item.label);
        if (res.error) {
          setErrorMessage(res.error);
          return;
        }
        parsedCosts[item.key] = res.value;
      }
    }

    let parsedExtraOptions: Record<string, unknown> | null = null;
    if (!extraOptionsMixed) {
      const trimmed = extraOptionsText.trim();
      if (!trimmed) {
        parsedExtraOptions = {};
      } else {
        try {
          const obj = JSON.parse(trimmed);
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            setErrorMessage("自定义 options JSON 顶层必须是对象");
            return;
          }
          parsedExtraOptions = obj as Record<string, unknown>;
        } catch (err) {
          setErrorMessage(
            `自定义 options JSON 语法错误：${err instanceof Error ? err.message : "格式无效"}`,
          );
          return;
        }
      }
    }

    let parsedVariantsJson: Record<string, Record<string, unknown>> | null = null;
    if (variantsJsonEdited && variantsJsonText.trim()) {
      try {
        const obj = JSON.parse(variantsJsonText.trim());
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
          setErrorMessage("变体高级参数 JSON 顶层必须是对象");
          return;
        }
        for (const [k, v] of Object.entries(obj)) {
          if (!v || typeof v !== "object" || Array.isArray(v)) {
            setErrorMessage(`变体「${k}」的值必须是 JSON 对象`);
            return;
          }
        }
        parsedVariantsJson = obj as Record<string, Record<string, unknown>>;
      } catch (err) {
        setErrorMessage(
          `变体高级参数 JSON 语法错误：${err instanceof Error ? err.message : "格式无效"}`,
        );
        return;
      }
    }

    const updated: ModelEntry[] = targets.map((target) => {
      // 1. Modalities (preserve unknown modalities on each target)
      const existingIn = target.modalities?.input ?? [];
      const unknownIn = existingIn.filter(
        (m) => !MODALITIES.includes(m as (typeof MODALITIES)[number]),
      );
      const nextKnownIn = MODALITIES.filter((mod) => {
        const st = inputModStates[mod];
        if (st === "mixed") return existingIn.includes(mod);
        return st === "checked";
      });
      const finalIn = [...nextKnownIn, ...unknownIn];

      const existingOut = target.modalities?.output ?? [];
      const unknownOut = existingOut.filter(
        (m) => !MODALITIES.includes(m as (typeof MODALITIES)[number]),
      );
      const nextKnownOut = MODALITIES.filter((mod) => {
        const st = outputModStates[mod];
        if (st === "mixed") return existingOut.includes(mod);
        return st === "checked";
      });
      const finalOut = [...nextKnownOut, ...unknownOut];

      const nextModalities =
        finalIn.length > 0 || finalOut.length > 0
          ? { input: finalIn, output: finalOut }
          : null;

      // 2. Variants (structured checkboxes win; existing variant objects survive)
      const baseVariants = parsedVariantsJson
        ? { ...parsedVariantsJson }
        : { ...(target.variants ?? {}) };
      const nextVariants: Record<string, Record<string, unknown>> = {};
      for (const vKey of VARIANT_ORDER) {
        const st = variantStates[vKey];
        const shouldInclude =
          st === "mixed" ? Boolean(target.variants && vKey in target.variants) : st === "checked";
        if (shouldInclude) {
          nextVariants[vKey] = baseVariants[vKey] ? { ...baseVariants[vKey] } : {};
        }
      }
      // Preserve custom variant keys not in VARIANT_ORDER
      for (const [k, v] of Object.entries(baseVariants)) {
        if (!VARIANT_ORDER.includes(k as (typeof VARIANT_ORDER)[number])) {
          nextVariants[k] = { ...v };
        }
      }

      // 3. Capabilities
      const resolveCap = (key: "attachment" | "tool_call" | "reasoning" | "temperature") => {
        const st = capStates[key];
        if (st === "mixed") return target[key];
        if (st === "true") return true;
        if (st === "false") return false;
        return null;
      };

      // 4. Options (structured fields win over extraOptions JSON)
      const baseExtraOpts = extraOptionsMixed
        ? extractExtraOptions(target.options)
        : (parsedExtraOptions ?? {});
      const nextOptions: Record<string, unknown> = { ...baseExtraOpts };

      const nextReasoningEffort =
        reasoningEffortVal === "__MIXED__"
          ? target.options?.reasoningEffort
          : reasoningEffortVal || undefined;
      if (nextReasoningEffort) {
        nextOptions.reasoningEffort = nextReasoningEffort;
      } else {
        delete nextOptions.reasoningEffort;
      }

      const nextTextVerbosity =
        textVerbosityVal === "__MIXED__"
          ? target.options?.textVerbosity
          : textVerbosityVal || undefined;
      if (nextTextVerbosity) {
        nextOptions.textVerbosity = nextTextVerbosity;
      } else {
        delete nextOptions.textVerbosity;
      }

      const nextBudget = budgetMixed ? getBudgetTokens(target.options) : budgetParsed.value;
      const existingThinking =
        target.options?.thinking &&
        typeof target.options.thinking === "object" &&
        !Array.isArray(target.options.thinking)
          ? { ...(target.options.thinking as Record<string, unknown>) }
          : {};
      if (nextBudget !== null && nextBudget !== undefined) {
        nextOptions.thinking = { ...existingThinking, budgetTokens: nextBudget };
      } else {
        delete existingThinking.budgetTokens;
        if (Object.keys(existingThinking).length > 0) {
          nextOptions.thinking = existingThinking;
        } else {
          delete nextOptions.thinking;
        }
      }

      return {
        ...target,
        key: isBatch ? target.key : trimmedKey,
        name: nameMixed ? target.name : nameText.trim() || null,
        id: idMixed ? target.id : idText.trim() || null,
        attachment: resolveCap("attachment"),
        tool_call: resolveCap("tool_call"),
        reasoning: resolveCap("reasoning"),
        temperature: resolveCap("temperature"),
        interleaved:
          interleavedVal === "__MIXED__"
            ? target.interleaved
            : deserializeInterleavedSelect(interleavedVal),
        limit: {
          ...target.limit,
          context: contextMixed ? target.limit.context : ctxParsed.value,
          output: outputMixed ? target.limit.output : outParsed.value,
          input: limitInputMixed ? target.limit.input : limInParsed.value,
          extra: { ...(target.limit.extra ?? {}) },
        },
        modalities: nextModalities,
        variants: nextVariants,
        cost: {
          ...target.cost,
          input: costMixed.input ? target.cost.input : parsedCosts.input,
          output: costMixed.output ? target.cost.output : parsedCosts.output,
          cache_read: costMixed.cache_read ? target.cost.cache_read : parsedCosts.cache_read,
          cache_write: costMixed.cache_write ? target.cost.cache_write : parsedCosts.cache_write,
          extra: { ...(target.cost.extra ?? {}) },
        },
        options: nextOptions,
        headers: headersMixed ? target.headers : rowsToHeaderMap(headerRows),
        provider: {
          ...target.provider,
            npm: providerNpmMixed ? target.provider.npm : normalizeNpmInput(providerNpmText) || null,
          api: providerApiMixed ? target.provider.api : providerApiText.trim() || null,
          extra: { ...(target.provider.extra ?? {}) },
        },
        meta: { ...target.meta },
        extra: { ...(target.extra ?? {}) },
      };
    });

    onSave(updated);
  };

  return (
    <Box>
      {/* Layer 4: Read-Only Metadata Subtitle Bar */}
      {metaChips.length > 0 && (
        <Box
          sx={{
            mb: 2,
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            backgroundColor: "#f1f5f9",
            border: "1px solid #e2e8f0",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {metaChips.join("  |  ")}
          </Typography>
        </Box>
      )}

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {/* Layer 2: Default Expanded Area (6 Core Groups) */}
      <Stack spacing={2.5} sx={{ mb: 3 }}>
        {/* Group 1: Model Key & Display Name */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          <TextField
            label="模型标识符 (Key)"
            disabled={isBatch}
            value={isBatch ? `已选 ${targets.length} 个模型` : keyText}
            onChange={(e) => setKeyText(e.target.value)}
            helperText={isBatch ? "批量编辑时模型标识符只读" : "配置文件 models 字典中的键名"}
            sx={{
              "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
            }}
          />

          <Box>
            <TextField
              fullWidth
              label="显示名称 (name)"
              placeholder={nameMixed ? MIXED_PLACEHOLDER : "例如：DeepSeek V4 Flash"}
              value={nameText}
              onChange={(e) => {
                setNameMixed(false);
                setNameText(e.target.value);
              }}
              InputProps={{
                endAdornment: defaults?.name ? (
                  <InputAdornment position="end">
                    <Chip
                      icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                      label={`默认: ${defaults.name}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                      onClick={() => {
                        setNameMixed(false);
                        setNameText(defaults.name ?? "");
                      }}
                    />
                  </InputAdornment>
                ) : undefined,
              }}
            />
          </Box>
        </Box>

        {/* Group 1b: 协议 (provider.npm)，模型级覆盖，留空继承提供商 */}
        <Box>
          <Autocomplete
            freeSolo
            options={[NPM_INHERIT_LABEL, ...MODEL_NPM_OPTIONS.map(displayNpm)]}
            value={providerNpmText}
            inputValue={providerNpmText}
            onInputChange={(_, newInput, reason) => {
              if (reason === "input" || reason === "clear") {
                setProviderNpmMixed(false);
                setProviderNpmText(newInput === NPM_INHERIT_LABEL ? "" : newInput);
              }
            }}
            onChange={(_, newVal) => {
              setProviderNpmMixed(false);
              const text = typeof newVal === "string" ? newVal : "";
              setProviderNpmText(text === NPM_INHERIT_LABEL ? "" : text);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="协议 (provider.npm)"
                placeholder={
                  providerNpmMixed
                    ? MIXED_PLACEHOLDER
                    : `继承：${displayNpm(providerNpm?.trim() || DEFAULT_NPM)}`
                }
                helperText={
                  providerNpmMixed
                    ? `${MIXED_PLACEHOLDER} 保持各行原值；选择「${NPM_INHERIT_LABEL}」统一清除覆盖`
                    : `留空则继承提供商（${displayNpm(providerNpm?.trim() || DEFAULT_NPM)}）；同一提供商下混用 Responses / Chat Completions / Anthropic 协议时可单独覆盖`
                }
                sx={{
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                  "& .MuiInputBase-input::placeholder": { color: "#94a3b8", opacity: 1 },
                }}
              />
            )}
          />
          {defaults?.catalogNpm && (
            <Chip
              icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
              label={`默认: ${displayNpm(defaults.catalogNpm)}`}
              size="small"
              color="primary"
              variant="outlined"
              onClick={() => {
                setProviderNpmMixed(false);
                setProviderNpmText(displayNpm(defaults.catalogNpm));
              }}
              sx={{ mt: 0.5 }}
            />
          )}
        </Box>

        {/* Group 2: Token Limits (limit.context & limit.output) */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          {/* Context Limit */}
          <Box>
            <TextField
              fullWidth
              type="number"
              label="上下文长度 (limit.context)"
              placeholder={contextMixed ? MIXED_PLACEHOLDER : "例如：131072"}
              value={contextText}
              onChange={(e) => {
                setContextMixed(false);
                setContextText(e.target.value);
              }}
              sx={{
                "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
              }}
            />
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
              {CONTEXT_PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setContextMixed(false);
                    setContextText(String(preset.value));
                  }}
                  sx={{ height: 20, fontSize: "0.7rem" }}
                />
              ))}
              {defaults?.limit.context !== null && defaults?.limit.context !== undefined && (
                <Chip
                  icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                  label={`默认: ${defaults.limit.context.toLocaleString("en-US")}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onClick={() => {
                    setContextMixed(false);
                    setContextText(String(defaults.limit.context));
                  }}
                />
              )}
            </Stack>
          </Box>

          {/* Output Limit */}
          <Box>
            <TextField
              fullWidth
              type="number"
              label="最大输出长度 (limit.output)"
              placeholder={outputMixed ? MIXED_PLACEHOLDER : "例如：16384"}
              value={outputText}
              onChange={(e) => {
                setOutputMixed(false);
                setOutputText(e.target.value);
              }}
              sx={{
                "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
              }}
            />
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
              {OUTPUT_PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setOutputMixed(false);
                    setOutputText(String(preset.value));
                  }}
                  sx={{ height: 20, fontSize: "0.7rem" }}
                />
              ))}
              {defaults?.limit.output !== null && defaults?.limit.output !== undefined && (
                <Chip
                  icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                  label={`默认: ${defaults.limit.output.toLocaleString("en-US")}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onClick={() => {
                    setOutputMixed(false);
                    setOutputText(String(defaults.limit.output));
                  }}
                />
              )}
            </Stack>
          </Box>
        </Box>

        {/* Group 3: Input Modalities */}
        <Box
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            border: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              输入支持的模态 (modalities.input)
            </Typography>
            {defaults && defaults.modalities.input.length > 0 && (
              <Chip
                icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                label={`默认: ${defaults.modalities.input.join(", ")}`}
                size="small"
                color="primary"
                variant="outlined"
                onClick={() => {
                  const next: Record<string, TriCheck> = {};
                  for (const mod of MODALITIES) {
                    next[mod] = defaults.modalities.input.includes(mod) ? "checked" : "unchecked";
                  }
                  setInputModStates(next);
                }}
              />
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            {MODALITIES.map((mod) => {
              const st = inputModStates[mod];
              const meta = MODALITY_META[mod];
              const IconComp = MODALITY_ICONS[mod];
              const isChecked = st === "checked";
              const isMixed = st === "mixed";
              return (
                <Tooltip
                  key={mod}
                  title={`${meta.label} (${meta.zhName})${isMixed ? ` · ${MIXED_PLACEHOLDER} 保持原值` : ""}`}
                  arrow
                >
                  <Box
                    component="label"
                    aria-label={`输入模态 ${meta.label}`}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      px: isMixed ? 0.75 : 0,
                      minWidth: 32,
                      height: 32,
                      borderRadius: 1,
                      cursor: "pointer",
                      color: isChecked ? meta.activeColor : "#94A3B8",
                      backgroundColor: isChecked
                        ? meta.activeBg
                        : isMixed
                          ? "rgba(100, 116, 139, 0.12)"
                          : "#ffffff",
                      border: isChecked
                        ? `1px solid ${meta.activeBorder}`
                        : isMixed
                          ? "1px dashed #64748B"
                          : "1px solid #cbd5e1",
                      transition: "all 120ms ease",
                    }}
                  >
                    <Checkbox
                      size="small"
                      indeterminate={isMixed}
                      checked={isChecked}
                      onChange={() =>
                        setInputModStates((prev) => ({
                          ...prev,
                          [mod]: prev[mod] === "checked" ? "unchecked" : "checked",
                        }))
                      }
                      icon={<IconComp sx={{ fontSize: 18, color: "#94A3B8" }} />}
                      checkedIcon={<IconComp sx={{ fontSize: 18, color: meta.activeColor }} />}
                      indeterminateIcon={<IconComp sx={{ fontSize: 18, color: "#64748B" }} />}
                      sx={{ p: 0 }}
                    />
                    {isMixed && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ ml: 0.5, fontFamily: MONOSPACE_FONT, color: "text.secondary" }}
                      >
                        {MIXED_PLACEHOLDER}
                      </Typography>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>

        {/* Group 4: Output Modalities */}
        <Box
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            border: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              输出支持的模态 (modalities.output)
            </Typography>
            {defaults && defaults.modalities.output.length > 0 && (
              <Chip
                icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                label={`默认: ${defaults.modalities.output.join(", ")}`}
                size="small"
                color="primary"
                variant="outlined"
                onClick={() => {
                  const next: Record<string, TriCheck> = {};
                  for (const mod of MODALITIES) {
                    next[mod] = defaults.modalities.output.includes(mod) ? "checked" : "unchecked";
                  }
                  setOutputModStates(next);
                }}
              />
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            {MODALITIES.map((mod) => {
              const st = outputModStates[mod];
              const meta = MODALITY_META[mod];
              const IconComp = MODALITY_ICONS[mod];
              const isChecked = st === "checked";
              const isMixed = st === "mixed";
              return (
                <Tooltip
                  key={mod}
                  title={`${meta.label} (${meta.zhName})${isMixed ? ` · ${MIXED_PLACEHOLDER} 保持原值` : ""}`}
                  arrow
                >
                  <Box
                    component="label"
                    aria-label={`输出模态 ${meta.label}`}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      px: isMixed ? 0.75 : 0,
                      minWidth: 32,
                      height: 32,
                      borderRadius: 1,
                      cursor: "pointer",
                      color: isChecked ? meta.activeColor : "#94A3B8",
                      backgroundColor: isChecked
                        ? meta.activeBg
                        : isMixed
                          ? "rgba(100, 116, 139, 0.12)"
                          : "#ffffff",
                      border: isChecked
                        ? `1px solid ${meta.activeBorder}`
                        : isMixed
                          ? "1px dashed #64748B"
                          : "1px solid #cbd5e1",
                      transition: "all 120ms ease",
                    }}
                  >
                    <Checkbox
                      size="small"
                      indeterminate={isMixed}
                      checked={isChecked}
                      onChange={() =>
                        setOutputModStates((prev) => ({
                          ...prev,
                          [mod]: prev[mod] === "checked" ? "unchecked" : "checked",
                        }))
                      }
                      icon={<IconComp sx={{ fontSize: 18, color: "#94A3B8" }} />}
                      checkedIcon={<IconComp sx={{ fontSize: 18, color: meta.activeColor }} />}
                      indeterminateIcon={<IconComp sx={{ fontSize: 18, color: "#64748B" }} />}
                      sx={{ p: 0 }}
                    />
                    {isMixed && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ ml: 0.5, fontFamily: MONOSPACE_FONT, color: "text.secondary" }}
                      >
                        {MIXED_PLACEHOLDER}
                      </Typography>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>

        {/* Group 5: Variants */}
        <Box
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            border: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              变体档位 (variants)
            </Typography>
            {defaults && Object.keys(defaults.variants).length > 0 && (
              <Chip
                icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                label={`使用默认变体 (${Object.keys(defaults.variants).join(", ")})`}
                size="small"
                color="primary"
                variant="outlined"
                onClick={() => {
                  const next: Record<string, TriCheck> = {};
                  for (const vKey of VARIANT_ORDER) {
                    next[vKey] = vKey in defaults.variants ? "checked" : "unchecked";
                  }
                  setVariantStates(next);
                }}
              />
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            {VARIANT_ORDER.map((vKey) => {
              const st = variantStates[vKey];
              const vMeta = VARIANT_META[vKey];
              return (
                <Tooltip key={vKey} title={vMeta.tooltip} arrow>
                  <Box
                    component="label"
                    aria-label={`变体 ${vKey}`}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      cursor: "pointer",
                      fontSize: "0.78rem",
                      fontFamily: MONOSPACE_FONT,
                      fontWeight: st === "checked" ? 700 : 400,
                      color: st === "checked" ? "primary.dark" : "text.primary",
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 1,
                      backgroundColor:
                        st === "checked" ? "rgba(27, 97, 201, 0.08)" : "transparent",
                    }}
                  >
                    <Checkbox
                      size="small"
                      indeterminate={st === "mixed"}
                      checked={st === "checked"}
                      onChange={() =>
                        setVariantStates((prev) => ({
                          ...prev,
                          [vKey]: prev[vKey] === "checked" ? "unchecked" : "checked",
                        }))
                      }
                      sx={{ p: 0.25 }}
                    />
                    <span>
                      {vMeta.shortLabel}
                      {st === "mixed" ? ` (${MIXED_PLACEHOLDER})` : ""}
                    </span>
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>

        {/* Group 6: Core Capabilities (4-column grid) */}
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
            核心能力开关
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 1,
            }}
          >
            {CAPABILITY_ITEMS.map(({ key, label }) => {
              const st = capStates[key];
              const defVal = defaults?.capabilities[key];
              return (
                <Stack
                  key={key}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 1,
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <Box
                    component="label"
                    sx={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                  >
                    <Checkbox
                      size="small"
                      indeterminate={st === "mixed"}
                      checked={st === "true"}
                      onChange={() =>
                        setCapStates((prev) => ({
                          ...prev,
                          [key]: prev[key] === "true" ? "false" : "true",
                        }))
                      }
                    />
                    <Box sx={{ ml: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {label}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {st === "mixed"
                          ? `${MIXED_PLACEHOLDER} 保持原值`
                          : st === "true"
                            ? "已开启 (true)"
                            : st === "false"
                              ? "显式关闭 (false)"
                              : "未设置 (null)"}
                      </Typography>
                    </Box>
                  </Box>

                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {st !== "unset" && (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() =>
                          setCapStates((prev) => ({ ...prev, [key]: "unset" }))
                        }
                        sx={{ minWidth: 0, px: 0.75, fontSize: "0.7rem" }}
                      >
                        重置
                      </Button>
                    )}
                    {defVal !== null && defVal !== undefined && (
                      <Chip
                        label={`默认: ${defVal ? "开启" : "关闭"}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                        onClick={() =>
                          setCapStates((prev) => ({
                            ...prev,
                            [key]: defVal ? "true" : "false",
                          }))
                        }
                      />
                    )}
                  </Stack>
                </Stack>
              );
            })}
          </Box>
        </Box>
      </Stack>

      {/* Layer 3: Collapsed Accordions */}
      {/* Accordion 1: Reasoning & Thinking */}
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">
            推理参数与思考配置 (options & interleaved)
          </Typography>
          {reasoningAccordionCount > 0 && (
            <Chip
              label={`已配置 ${reasoningAccordionCount} 项`}
              size="small"
              color="primary"
              sx={{ height: 20 }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <FormControl size="small" fullWidth>
              <InputLabel id="reasoning-effort-label">
                默认推理强度 (options.reasoningEffort)
              </InputLabel>
              <Select
                labelId="reasoning-effort-label"
                label="默认推理强度 (options.reasoningEffort)"
                value={reasoningEffortVal}
                onChange={(e) => setReasoningEffortVal(e.target.value)}
              >
                {isBatch && <MenuItem value="__MIXED__">&lt;...&gt; 保持原值</MenuItem>}
                <MenuItem value="">未设置 (null)</MenuItem>
                {REASONING_EFFORTS.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel id="text-verbosity-label">
                输出详略度 (options.textVerbosity)
              </InputLabel>
              <Select
                labelId="text-verbosity-label"
                label="输出详略度 (options.textVerbosity)"
                value={textVerbosityVal}
                onChange={(e) => setTextVerbosityVal(e.target.value)}
              >
                {isBatch && <MenuItem value="__MIXED__">&lt;...&gt; 保持原值</MenuItem>}
                <MenuItem value="">未设置 (null)</MenuItem>
                {TEXT_VERBOSITY.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <FormControl size="small" fullWidth>
                <InputLabel id="interleaved-label">
                  流式交错思考字段 (interleaved)
                </InputLabel>
                <Select
                  labelId="interleaved-label"
                  label="流式交错思考字段 (interleaved)"
                  value={interleavedVal}
                  onChange={(e) => setInterleavedVal(e.target.value)}
                >
                  {isBatch && <MenuItem value="__MIXED__">&lt;...&gt; 保持原值</MenuItem>}
                  <MenuItem value="">未设置 (null)</MenuItem>
                  <MenuItem value="false">false（禁用交错思考）</MenuItem>
                  <MenuItem value="true">true（启用默认交错思考）</MenuItem>
                  {INTERLEAVED_FIELDS.map((field) => (
                    <MenuItem key={field} value={field}>
                      {field}（保存为 {"{"} field: "{field}" {"}"}）
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {defaults?.interleaved !== null && defaults?.interleaved !== undefined && (
                <Chip
                  icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                  label={`默认: ${String(defaults.interleaved)}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onClick={() =>
                    setInterleavedVal(serializeInterleavedSelect(defaults.interleaved))
                  }
                  sx={{ mt: 0.75 }}
                />
              )}
            </Box>

            <TextField
              fullWidth
              type="number"
              label="思考预算 (options.thinking.budgetTokens)"
              placeholder={budgetMixed ? MIXED_PLACEHOLDER : "例如：16000"}
              value={budgetText}
              onChange={(e) => {
                setBudgetMixed(false);
                setBudgetText(e.target.value);
              }}
              sx={{
                "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
              }}
            />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Accordion 2: Max Input Limit & Cost */}
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">
            最大输入限制与计费价格 (limit.input & cost)
          </Typography>
          {costAccordionCount > 0 && (
            <Chip
              label={`已配置 ${costAccordionCount} 项`}
              size="small"
              color="primary"
              sx={{ height: 20 }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Box>
              <TextField
                fullWidth
                type="number"
                label="最大输入 Token 限制 (limit.input)"
                placeholder={limitInputMixed ? MIXED_PLACEHOLDER : "未设置（默认与上下文长度一致）"}
                value={limitInputText}
                onChange={(e) => {
                  setLimitInputMixed(false);
                  setLimitInputText(e.target.value);
                }}
                sx={{
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
                InputProps={{
                  endAdornment:
                    defaults?.limit.input !== null && defaults?.limit.input !== undefined ? (
                      <InputAdornment position="end">
                        <Chip
                          label={`默认: ${defaults.limit.input}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                          onClick={() => {
                            setLimitInputMixed(false);
                            setLimitInputText(String(defaults.limit.input));
                          }}
                        />
                      </InputAdornment>
                    ) : undefined,
                }}
              />
            </Box>

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                  计费价格 (单位: $/1M tokens)
                </Typography>
                {defaults &&
                  Object.values(defaults.cost).some((v) => v !== null && v !== undefined) && (
                    <Chip
                      icon={<AutoFixHighIcon sx={{ fontSize: "13px !important" }} />}
                      label="一键填入默认价格"
                      size="small"
                      color="primary"
                      variant="outlined"
                      onClick={() => {
                        setCostMixed({
                          input: false,
                          output: false,
                          cache_read: false,
                          cache_write: false,
                        });
                        setCostText({
                          input:
                            defaults.cost.input !== null ? String(defaults.cost.input) : "",
                          output:
                            defaults.cost.output !== null ? String(defaults.cost.output) : "",
                          cache_read:
                            defaults.cost.cache_read !== null
                              ? String(defaults.cost.cache_read)
                              : "",
                          cache_write:
                            defaults.cost.cache_write !== null
                              ? String(defaults.cost.cache_write)
                              : "",
                        });
                      }}
                    />
                  )}
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 2,
                }}
              >
                {COST_ITEMS.map(({ key, label }) => {
                  const defCost = defaults?.cost[key];
                  return (
                    <Box key={key}>
                      <TextField
                        fullWidth
                        type="number"
                        label={label}
                        placeholder={costMixed[key] ? MIXED_PLACEHOLDER : "0.00"}
                        value={costText[key]}
                        onChange={(e) => {
                          setCostMixed((prev) => ({ ...prev, [key]: false }));
                          setCostText((prev) => ({ ...prev, [key]: e.target.value }));
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">$/1M</InputAdornment>
                          ),
                        }}
                        sx={{
                          "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                        }}
                      />
                      {defCost !== null && defCost !== undefined && (
                        <Chip
                          label={`默认: $${defCost}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                          onClick={() => {
                            setCostMixed((prev) => ({ ...prev, [key]: false }));
                            setCostText((prev) => ({ ...prev, [key]: String(defCost) }));
                          }}
                          sx={{ mt: 0.5 }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Accordion 3: Per-Model Driver Override, Headers & Advanced JSON */}
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">
            单模型驱动覆盖、请求头 (headers) 与高级 JSON
          </Typography>
          {advancedAccordionCount > 0 && (
            <Chip
              label={`已配置 ${advancedAccordionCount} 项`}
              size="small"
              color="primary"
              sx={{ height: 20 }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              <TextField
                label="单模型端点覆盖 (provider.api)"
                placeholder={providerApiMixed ? MIXED_PLACEHOLDER : "留空则继承提供商 baseURL"}
                value={providerApiText}
                onChange={(e) => {
                  setProviderApiMixed(false);
                  setProviderApiText(e.target.value);
                }}
                sx={{
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
              />
              <TextField
                label="底层映射模型 ID (id)"
                placeholder={idMixed ? MIXED_PLACEHOLDER : "留空则默认使用模型 Key"}
                value={idText}
                onChange={(e) => {
                  setIdMixed(false);
                  setIdText(e.target.value);
                }}
                sx={{
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
              />
            </Box>

            <KeyValueHeaderEditor
              label="模型专属请求头 (headers)"
              rows={headerRows}
              isMixed={headersMixed}
              onClearMixed={() => setHeadersMixed(false)}
              onChange={setHeaderRows}
            />

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                  自定义 options 高级参数 (JSON 对象)
                </Typography>
                {extraOptionsMixed && (
                  <Button
                    size="small"
                    onClick={() => {
                      setExtraOptionsMixed(false);
                      setExtraOptionsText("{}");
                    }}
                  >
                    解除 &lt;...&gt; 并统一编辑
                  </Button>
                )}
              </Stack>
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={7}
                placeholder={
                  extraOptionsMixed
                    ? MIXED_PLACEHOLDER
                    : '{\n  "topP": 0.95\n}'
                }
                value={extraOptionsText}
                onChange={(e) => {
                  setExtraOptionsMixed(false);
                  setExtraOptionsText(e.target.value);
                }}
                helperText="编辑模型 options 中的扩展字段；结构化推理参数（reasoningEffort、textVerbosity、thinking.budgetTokens）优先"
                sx={{
                  "& .MuiInputBase-input": {
                    fontFamily: MONOSPACE_FONT,
                    fontSize: "0.78125rem",
                  },
                }}
              />
            </Box>

            <Box>
              <Tooltip title="若需要为某个变体配置内部参数对象，可在此以 JSON 形式补充；已勾选的变体档位会自动合并保留">
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 0.5 }}>
                  变体内部高级参数 (variants JSON，可选)
                </Typography>
              </Tooltip>
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
                placeholder='{\n  "high": {}\n}'
                value={variantsJsonText}
                onChange={(e) => {
                  setVariantsJsonEdited(true);
                  setVariantsJsonText(e.target.value);
                }}
                sx={{
                  "& .MuiInputBase-input": {
                    fontFamily: MONOSPACE_FONT,
                    fontSize: "0.78125rem",
                  },
                }}
              />
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Dialog Footer Actions */}
      <Stack
        direction="row"
        justifyContent="flex-end"
        spacing={1}
        sx={{ mt: 2.5, pt: 1.5, borderTop: "1px solid #e2e8f0" }}
      >
        <Button variant="outlined" color="inherit" onClick={onCancel}>
          取消
        </Button>
        <Button variant="contained" onClick={handleConfirm}>
          {isBatch ? `应用到所选 (${targets.length})` : "确定修改"}
        </Button>
      </Stack>
    </Box>
  );
};
