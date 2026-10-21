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
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { bridge } from "../api/bridge";
import {
  NPM_PRESETS,
  type ApiKeyInfo,
  type ProviderEntry,
} from "../types/domain";
import {
  KeyValueHeaderEditor,
  headerMapToRows,
  rowsToHeaderMap,
  type HeaderRow,
} from "./KeyValueHeaderEditor";
import { MIXED_PLACEHOLDER } from "../utils/modelHelpers";
import { MONOSPACE_FONT } from "../theme";

type TimeoutMode = "unset" | "disabled" | "number" | "mixed";

interface TimeoutFieldState {
  mode: TimeoutMode;
  msText: string;
}

function initTimeoutState(values: Array<number | false | null>): TimeoutFieldState {
  const first = values[0];
  const allSame = values.every((v) => v === first);
  if (!allSame) {
    return { mode: "mixed", msText: "" };
  }
  if (first === null || first === undefined) {
    return { mode: "unset", msText: "" };
  }
  if (first === false) {
    return { mode: "disabled", msText: "" };
  }
  return { mode: "number", msText: String(first) };
}

function resolveTimeoutValue(
  state: TimeoutFieldState,
  original: number | false | null,
): { value: number | false | null; error?: string } {
  if (state.mode === "mixed") return { value: original };
  if (state.mode === "unset") return { value: null };
  if (state.mode === "disabled") return { value: false };
  const trimmed = state.msText.trim();
  if (!trimmed) return { value: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: original, error: "超时时间必须是非负毫秒数" };
  }
  return { value: Math.round(parsed) };
}

const TIMEOUT_LABELS: Array<{
  key: "timeout" | "headerTimeout" | "chunkTimeout";
  title: string;
  desc: string;
}> = [
  { key: "timeout", title: "总请求超时 (timeout)", desc: "整体请求最大等待时长" },
  { key: "headerTimeout", title: "响应头超时 (headerTimeout)", desc: "等待首字节响应头时长" },
  { key: "chunkTimeout", title: "流式分块超时 (chunkTimeout)", desc: "流式输出相邻分块间隔时长" },
];

interface ProviderEditSectionProps {
  targets: ProviderEntry[];
  existingKeys: string[];
  isBatch: boolean;
  onSave: (updated: ProviderEntry[]) => void;
  onCancel: () => void;
}

export const ProviderEditSection: React.FC<ProviderEditSectionProps> = ({
  targets,
  existingKeys,
  isBatch,
  onSave,
  onCancel,
}) => {
  const first = targets[0];

  const isSame = <T,>(getter: (p: ProviderEntry) => T): boolean => {
    const base = JSON.stringify(getter(first));
    return targets.every((item) => JSON.stringify(getter(item)) === base);
  };

  // Layer 2 States
  const [keyText, setKeyText] = useState<string>(first.key);
  const [nameMixed, setNameMixed] = useState<boolean>(() => isBatch && !isSame((p) => p.name ?? ""));
  const [nameText, setNameText] = useState<string>(() =>
    isBatch && !isSame((p) => p.name ?? "") ? "" : first.name ?? "",
  );

  const [npmMixed, setNpmMixed] = useState<boolean>(() => isBatch && !isSame((p) => p.npm ?? ""));
  const [npmText, setNpmText] = useState<string>(() =>
    isBatch && !isSame((p) => p.npm ?? "") ? "" : first.npm ?? "",
  );

  const [baseURLMixed, setBaseURLMixed] = useState<boolean>(
    () => isBatch && !isSame((p) => p.options.baseURL ?? ""),
  );
  const [baseURLText, setBaseURLText] = useState<string>(() =>
    isBatch && !isSame((p) => p.options.baseURL ?? "") ? "" : first.options.baseURL ?? "",
  );

  const [apiKeyMixed, setApiKeyMixed] = useState<boolean>(
    () => isBatch && !isSame((p) => p.options.apiKey ?? ""),
  );
  const [apiKeyText, setApiKeyText] = useState<string>(() =>
    isBatch && !isSame((p) => p.options.apiKey ?? "") ? "" : first.options.apiKey ?? "",
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);

  const [cacheKeyState, setCacheKeyState] = useState<"mixed" | "unset" | "true" | "false">(() => {
    if (isBatch && !isSame((p) => p.options.setCacheKey)) return "mixed";
    if (first.options.setCacheKey === true) return "true";
    if (first.options.setCacheKey === false) return "false";
    return "unset";
  });

  // Layer 3 — Accordion 1: Timeouts
  const [timeouts, setTimeouts] = useState<{
    timeout: TimeoutFieldState;
    headerTimeout: TimeoutFieldState;
    chunkTimeout: TimeoutFieldState;
  }>(() => ({
    timeout: initTimeoutState(targets.map((p) => p.options.timeout)),
    headerTimeout: initTimeoutState(targets.map((p) => p.options.headerTimeout)),
    chunkTimeout: initTimeoutState(targets.map((p) => p.options.chunkTimeout)),
  }));

  // Layer 3 — Accordion 2: Headers & optionsExtra
  const [headersMixed, setHeadersMixed] = useState<boolean>(
    () => isBatch && !isSame((p) => p.options.headers),
  );
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() =>
    isBatch && !isSame((p) => p.options.headers) ? [] : headerMapToRows(first.options.headers),
  );

  const [optionsExtraMixed, setOptionsExtraMixed] = useState<boolean>(
    () => isBatch && !isSame((p) => p.optionsExtra),
  );
  const [optionsExtraText, setOptionsExtraText] = useState<string>(() => {
    if (isBatch && !isSame((p) => p.optionsExtra)) return "";
    const obj = first.optionsExtra ?? {};
    return Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : "";
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live API Key inspection via backend describeApiKey (never exposes resolved secret)
  useEffect(() => {
    if (apiKeyMixed) {
      setApiKeyInfo(null);
      return;
    }
    let cancelled = false;
    bridge
      .describeApiKey(apiKeyText || null)
      .then((info) => {
        if (!cancelled) setApiKeyInfo(info);
      })
      .catch(() => {
        if (!cancelled) setApiKeyInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKeyText, apiKeyMixed]);

  // Active counts for Layer 3 Accordion Badges
  const configuredTimeoutCount = useMemo(() => {
    let count = 0;
    for (const k of ["timeout", "headerTimeout", "chunkTimeout"] as const) {
      const st = timeouts[k];
      if (st.mode === "disabled" || (st.mode === "number" && st.msText.trim() !== "")) {
        count += 1;
      } else if (st.mode === "mixed") {
        if (targets.some((p) => p.options[k] !== null && p.options[k] !== undefined)) {
          count += 1;
        }
      }
    }
    return count;
  }, [timeouts, targets]);

  const configuredHeadersAndExtraCount = useMemo(() => {
    let count = 0;
    if (headersMixed) {
      if (targets.some((p) => Object.keys(p.options.headers ?? {}).length > 0)) count += 1;
    } else {
      count += headerRows.filter((r) => r.name.trim() !== "").length;
    }
    if (optionsExtraMixed) {
      if (targets.some((p) => Object.keys(p.optionsExtra ?? {}).length > 0)) count += 1;
    } else if (optionsExtraText.trim()) {
      try {
        const parsed = JSON.parse(optionsExtraText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          count += Object.keys(parsed).length;
        }
      } catch {
        count += 1;
      }
    }
    return count;
  }, [headersMixed, headerRows, optionsExtraMixed, optionsExtraText, targets]);

  const handleConfirm = () => {
    setErrorMessage(null);

    const trimmedKey = keyText.trim();
    if (!isBatch) {
      if (!trimmedKey) {
        setErrorMessage("提供商标识符不能为空");
        return;
      }
      if (
        trimmedKey !== first.key &&
        existingKeys.some((k) => k === trimmedKey)
      ) {
        setErrorMessage(`提供商标识符「${trimmedKey}」已存在，请使用唯一标识符`);
        return;
      }
    }

    let parsedOptionsExtra: Record<string, unknown> | null = null;
    if (!optionsExtraMixed) {
      const trimmedExtra = optionsExtraText.trim();
      if (!trimmedExtra) {
        parsedOptionsExtra = {};
      } else {
        try {
          const candidate = JSON.parse(trimmedExtra);
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            setErrorMessage("扩展参数 options JSON 顶层必须是 JSON 对象");
            return;
          }
          parsedOptionsExtra = candidate as Record<string, unknown>;
        } catch (err) {
          setErrorMessage(
            `扩展参数 options JSON 语法错误：${err instanceof Error ? err.message : "格式无效"}`,
          );
          return;
        }
      }
    }

    const updated: ProviderEntry[] = [];
    for (const target of targets) {
      const tRes = resolveTimeoutValue(timeouts.timeout, target.options.timeout);
      if (tRes.error) {
        setErrorMessage(tRes.error);
        return;
      }
      const hRes = resolveTimeoutValue(timeouts.headerTimeout, target.options.headerTimeout);
      if (hRes.error) {
        setErrorMessage(hRes.error);
        return;
      }
      const cRes = resolveTimeoutValue(timeouts.chunkTimeout, target.options.chunkTimeout);
      if (cRes.error) {
        setErrorMessage(cRes.error);
        return;
      }

      const nextSetCacheKey =
        cacheKeyState === "mixed"
          ? target.options.setCacheKey
          : cacheKeyState === "true"
            ? true
            : cacheKeyState === "false"
              ? false
              : null;

      updated.push({
        ...target,
        key: isBatch ? target.key : trimmedKey,
        name: nameMixed ? target.name : nameText.trim() || null,
        npm: npmMixed ? target.npm : npmText.trim() || null,
        options: {
          ...target.options,
          baseURL: baseURLMixed ? target.options.baseURL : baseURLText.trim() || null,
          apiKey: apiKeyMixed ? target.options.apiKey : apiKeyText.trim() || null,
          setCacheKey: nextSetCacheKey,
          timeout: tRes.value,
          headerTimeout: hRes.value,
          chunkTimeout: cRes.value,
          headers: headersMixed ? target.options.headers : rowsToHeaderMap(headerRows),
        },
        optionsExtra: optionsExtraMixed
          ? target.optionsExtra
          : (parsedOptionsExtra ?? target.optionsExtra),
      });
    }

    onSave(updated);
  };

  return (
    <Box>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {/* Layer 2: Default Expanded Area (6 Core Provider Fields) */}
      <Stack spacing={2.5} sx={{ mb: 3 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          {/* 1. Provider Key */}
          <TextField
            label="提供商标识符 (Key)"
            disabled={isBatch}
            value={isBatch ? `已选 ${targets.length} 个提供商` : keyText}
            onChange={(e) => setKeyText(e.target.value)}
            helperText={isBatch ? "批量编辑模式下不可修改提供商标识符" : "用于 opencode.json 中 provider 字典的键名"}
            sx={{
              "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
            }}
          />

          {/* 2. Provider Name */}
          <TextField
            label="提供商名称 (Name)"
            placeholder={nameMixed ? MIXED_PLACEHOLDER : "例如：NewAPI 主力网关"}
            value={nameText}
            onChange={(e) => {
              setNameMixed(false);
              setNameText(e.target.value);
            }}
            helperText={nameMixed ? "所选提供商名称不一致（<...>），不改动将保留各行原值" : "界面展示的友好名称"}
          />
        </Box>

        {/* 3. Provider Type (npm) */}
        <Box>
          <Autocomplete
            freeSolo
            options={[...NPM_PRESETS]}
            value={npmText}
            inputValue={npmText}
            onInputChange={(_, newInput, reason) => {
              if (reason === "input" || reason === "clear") {
                setNpmMixed(false);
                setNpmText(newInput);
              }
            }}
            onChange={(_, newVal) => {
              setNpmMixed(false);
              setNpmText(typeof newVal === "string" ? newVal : "");
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="提供商类型 (npm 驱动包)"
                placeholder={npmMixed ? MIXED_PLACEHOLDER : "@ai-sdk/openai-compatible"}
                helperText="用途说明：对接 /v1/responses 响应端点请选择 @ai-sdk/openai；对接 NewAPI 等 /v1/chat/completions 兼容端点请选择 @ai-sdk/openai-compatible"
                sx={{
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
              />
            )}
          />
        </Box>

        {/* 4. BaseURL */}
        <TextField
          label="API 基础地址 (options.baseURL)"
          placeholder={baseURLMixed ? MIXED_PLACEHOLDER : "https://api.example.com/v1"}
          value={baseURLText}
          onChange={(e) => {
            setBaseURLMixed(false);
            setBaseURLText(e.target.value);
          }}
          helperText={
            baseURLMixed
              ? "所选提供商 URL 不一致（<...>），不改动将保留各行原值"
              : "提供商接口根路径，拉取模型时将请求 ${baseURL}/models"
          }
          sx={{
            "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
          }}
        />

        {/* 5. API Key */}
        <Box>
          <TextField
            fullWidth
            label="API 密钥 (options.apiKey)"
            type={showApiKey || apiKeyMixed ? "text" : "password"}
            placeholder={apiKeyMixed ? MIXED_PLACEHOLDER : "输入密钥或使用右侧快捷插入引用"}
            value={apiKeyText}
            onChange={(e) => {
              setApiKeyMixed(false);
              setApiKeyText(e.target.value);
            }}
            sx={{
              "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
            }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Tooltip title="插入环境变量引用模板">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setApiKeyMixed(false);
                          setApiKeyText("{env:VAR_NAME}");
                          setShowApiKey(true);
                        }}
                        sx={{ minHeight: 22, py: 0, px: 0.75, fontSize: "0.7rem", fontFamily: MONOSPACE_FONT }}
                      >
                        {"{env:VAR_NAME}"}
                      </Button>
                    </Tooltip>
                    <Tooltip title="插入密钥文件引用模板">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setApiKeyMixed(false);
                          setApiKeyText("{file:~/.secrets/key}");
                          setShowApiKey(true);
                        }}
                        sx={{ minHeight: 22, py: 0, px: 0.75, fontSize: "0.7rem", fontFamily: MONOSPACE_FONT }}
                      >
                        {"{file:~/.secrets/key}"}
                      </Button>
                    </Tooltip>
                    <Tooltip title={showApiKey ? "隐藏输入内容" : "显示输入内容"}>
                      <IconButton
                        size="small"
                        aria-label="切换密钥输入可见性"
                        onClick={() => setShowApiKey((prev) => !prev)}
                      >
                        {showApiKey ? (
                          <VisibilityOffOutlinedIcon fontSize="small" />
                        ) : (
                          <VisibilityOutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.75 }}>
            {apiKeyMixed ? (
              <Chip label="密钥状态: <...>（各行保持原值）" size="small" />
            ) : !apiKeyInfo || apiKeyInfo.kind === "empty" ? (
              <Chip label="未配置 API 密钥" size="small" variant="outlined" />
            ) : apiKeyInfo.kind === "env" ? (
              <Chip
                label={
                  apiKeyInfo.resolvable
                    ? `环境变量 ${apiKeyInfo.name}（已就绪，不会明文回显）`
                    : `环境变量 ${apiKeyInfo.name}（当前环境未设置该变量）`
                }
                size="small"
                color={apiKeyInfo.resolvable ? "success" : "warning"}
                variant="outlined"
              />
            ) : apiKeyInfo.kind === "file" ? (
              <Chip
                label={
                  apiKeyInfo.resolvable
                    ? `密钥文件 ${apiKeyInfo.name}（文件有效，不会明文回显）`
                    : `密钥文件 ${apiKeyInfo.name}（文件不存在）`
                }
                size="small"
                color={apiKeyInfo.resolvable ? "success" : "warning"}
                variant="outlined"
              />
            ) : (
              <Chip
                label="字面量密钥（建议使用 {env:VAR_NAME} 或 {file:~/.secrets/key} 引用）"
                size="small"
                color="info"
                variant="outlined"
              />
            )}
          </Stack>
        </Box>

        {/* 6. setCacheKey */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            border: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              启用缓存键 (options.setCacheKey)
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              控制是否向兼容网关发送 Prompt 缓存标识键（未设置时不写入配置文件）
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            {isBatch ? (
              <FormControlLabel
                control={
                  <Checkbox
                    indeterminate={cacheKeyState === "mixed"}
                    checked={cacheKeyState === "true"}
                    onChange={() => {
                      setCacheKeyState((prev) =>
                        prev === "mixed" ? "true" : prev === "true" ? "false" : "true",
                      );
                    }}
                  />
                }
                label={
                  cacheKeyState === "mixed"
                    ? `<...> 保持各行原值`
                    : cacheKeyState === "true"
                      ? "已启用 (true)"
                      : cacheKeyState === "false"
                        ? "已禁用 (false)"
                        : "未设置 (null)"
                }
              />
            ) : (
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={cacheKeyState === "true"}
                    onChange={(e) => setCacheKeyState(e.target.checked ? "true" : "false")}
                  />
                }
                label={
                  cacheKeyState === "true"
                    ? "已启用 (true)"
                    : cacheKeyState === "false"
                      ? "显式禁用 (false)"
                      : "未设置"
                }
              />
            )}
            {cacheKeyState !== "unset" && (
              <Button
                size="small"
                variant="text"
                onClick={() => setCacheKeyState("unset")}
              >
                设为未设置
              </Button>
            )}
          </Stack>
        </Stack>
      </Stack>

      {/* Layer 3: Collapsed Accordions */}
      {/* Accordion 1: Timeout Strategy */}
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">
            超时策略 (timeout / headerTimeout / chunkTimeout)
          </Typography>
          {configuredTimeoutCount > 0 && (
            <Chip
              label={`已配置 ${configuredTimeoutCount} 项`}
              size="small"
              color="primary"
              sx={{ height: 20 }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1.75}>
            {TIMEOUT_LABELS.map(({ key, title, desc }) => {
              const st = timeouts[key];
              return (
                <Stack
                  key={key}
                  direction={{ xs: "column", sm: "row" }}
                  alignItems={{ xs: "stretch", sm: "center" }}
                  justifyContent="space-between"
                  spacing={1.5}
                  sx={{
                    p: 1.25,
                    borderRadius: 1,
                    border: "1px solid #f1f5f9",
                    backgroundColor: "#fafbfc",
                  }}
                >
                  <Box sx={{ minWidth: 210 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {desc}
                    </Typography>
                  </Box>

                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={st.mode === "number"}
                          onChange={(e) => {
                            const enableNumeric = e.target.checked;
                            setTimeouts((prev) => ({
                              ...prev,
                              [key]: {
                                mode: enableNumeric ? "number" : "disabled",
                                msText: enableNumeric ? prev[key].msText || "60000" : "",
                              },
                            }));
                          }}
                        />
                      }
                      label={
                        st.mode === "mixed"
                          ? `<...> 混合状态`
                          : st.mode === "number"
                            ? "启用超时"
                            : st.mode === "disabled"
                              ? "禁用超时 (false)"
                              : "未设置 (null)"
                      }
                    />

                    <Select
                      size="small"
                      value={st.mode}
                      onChange={(e) => {
                        const nextMode = e.target.value as TimeoutMode;
                        setTimeouts((prev) => ({
                          ...prev,
                          [key]: {
                            mode: nextMode,
                            msText:
                              nextMode === "number"
                                ? prev[key].msText || "60000"
                                : "",
                          },
                        }));
                      }}
                      sx={{ minWidth: 145, fontSize: "0.8125rem" }}
                    >
                      {isBatch && <MenuItem value="mixed">&lt;...&gt; 保持原值</MenuItem>}
                      <MenuItem value="unset">未设置 (null)</MenuItem>
                      <MenuItem value="number">指定毫秒数</MenuItem>
                      <MenuItem value="disabled">禁用超时 (false)</MenuItem>
                    </Select>

                    <TextField
                      size="small"
                      type="number"
                      disabled={st.mode !== "number"}
                      placeholder={st.mode === "mixed" ? MIXED_PLACEHOLDER : "60000"}
                      value={st.msText}
                      onChange={(e) => {
                        const text = e.target.value;
                        setTimeouts((prev) => ({
                          ...prev,
                          [key]: { mode: "number", msText: text },
                        }));
                      }}
                      sx={{
                        width: 155,
                        "& .MuiInputBase-input": {
                          fontFamily: MONOSPACE_FONT,
                          textAlign: "right",
                        },
                      }}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                      }}
                    />
                  </Stack>
                </Stack>
              );
            })}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Accordion 2: Custom Headers & Extra Options */}
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">
            自定义请求头 (options.headers) 与扩展参数 (options)
          </Typography>
          {configuredHeadersAndExtraCount > 0 && (
            <Chip
              label={`已配置 ${configuredHeadersAndExtraCount} 项`}
              size="small"
              color="primary"
              sx={{ height: 20 }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <KeyValueHeaderEditor
              label="自定义请求头 (options.headers)"
              rows={headerRows}
              isMixed={headersMixed}
              onClearMixed={() => setHeadersMixed(false)}
              onChange={setHeaderRows}
            />

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                  其它自定义 options 扩展字段 (JSON 对象)
                </Typography>
                {optionsExtraMixed && (
                  <Button
                    size="small"
                    onClick={() => {
                      setOptionsExtraMixed(false);
                      setOptionsExtraText("{}");
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
                maxRows={8}
                placeholder={
                  optionsExtraMixed
                    ? MIXED_PLACEHOLDER
                    : '{\n  "organization": "org-xxx"\n}'
                }
                value={optionsExtraText}
                onChange={(e) => {
                  setOptionsExtraMixed(false);
                  setOptionsExtraText(e.target.value);
                }}
                helperText="用于配置非标准 options 字段；上方结构化字段（baseURL、apiKey、timeout 等）优先级更高"
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
