import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { BridgeError, bridge } from "./api/bridge";
import type {
  AppInfo,
  ConfigDocument,
  ConfigSource,
  MetadataStatus,
  ModelEntry,
  ModelParamRequest,
  ModelParamResult,
  PROVIDER_COLUMN_IDS,
  ProviderEntry,
  Settings,
} from "./types/domain";
import { ProviderTable } from "./components/ProviderTable";
import { ModelTable, type ModelColumnId } from "./components/ModelTable";
import { EditDialog, type EditDialogState } from "./components/EditDialog";
import { AddModelsDialog } from "./components/AddModelsDialog";
import {
  applyDefaultsToModelColumns,
  applyVariantsFromCell,
  createEmptyModel,
  createEmptyProvider,
  diffManagedFields,
  effectiveNpm,
  MANAGED_FIELD_LABELS,
  matchesParamTemplate,
  normalizeNpmInput,
  applyParamResult,
  type ManagedField,
  parseModalitiesFromCell,
  splitCatalogPath,
  toggleKnownModality,
  toggleVariantKey,
} from "./utils/modelHelpers";
import { MONOSPACE_FONT } from "./theme";

type ProviderColumnId = (typeof PROVIDER_COLUMN_IDS)[number];

/** 一次参数生成任务：oldNpm 仅在协议变更（smart 模式）时用于判断是否手改过 */
interface ParamJob {
  key: string;
  modelId: string | null;
  oldNpm: string;
  newNpm: string;
}

function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "未知时间";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const App: React.FC = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [metadataStatus, setMetadataStatus] = useState<MetadataStatus | null>(null);
  const [documentData, setDocumentData] = useState<ConfigDocument | null>(null);

  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bridge error code of the failed load; picks extra actions for the error banner
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null);

  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshingMeta, setRefreshingMeta] = useState<boolean>(false);
  const [metaRefreshError, setMetaRefreshError] = useState<string | null>(null);
  const [applyingDefaults, setApplyingDefaults] = useState<boolean>(false);

  // Path bar fallback (shown when pickConfigFile throws dialog_unavailable or user clicks path edit)
  const [showPathBar, setShowPathBar] = useState<boolean>(false);
  const [pathInput, setPathInput] = useState<string>("");

  // Conflict Dialog state
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Which document is edited: opencode.json directly, or CC Switch's database
  const [configSource, setConfigSource] = useState<ConfigSource>("opencode");
  // CC Switch notices are dismissed per load; a reload shows them again
  const [ccswitchNoticesOpen, setCcswitchNoticesOpen] = useState<boolean>(true);

  // Split Pane ratio (default 0.4)
  const [splitRatio, setSplitRatio] = useState<number>(0.4);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  // Active Page Tab
  const [activePage, setActivePage] = useState<string>("providers");

  // Selection & Row Checks
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [checkedProviderKeys, setCheckedProviderKeys] = useState<string[]>([]);
  const [checkedModelKeys, setCheckedModelKeys] = useState<string[]>([]);

  // Dialogs
  const [editDialogState, setEditDialogState] = useState<EditDialogState>(null);
  const [addModelsOpen, setAddModelsOpen] = useState<boolean>(false);

  // Status banner / toast（action 用于「撤销」等单步操作）
  const [toast, setToast] = useState<{
    message: string;
    severity: "info" | "warning" | "error" | "success";
    action?: { label: string; onClick: () => void };
  } | null>(null);

  const notify = useCallback(
    (
      message: string,
      severity: "info" | "warning" | "error" | "success" = "info",
      action?: { label: string; onClick: () => void },
    ) => {
      setToast({ message, severity, action });
    },
    [],
  );

  // 参数生成：进行中标记 + 手改行的覆盖确认
  const [generatingParams, setGeneratingParams] = useState<boolean>(false);
  const [paramConfirm, setParamConfirm] = useState<{
    providerKey: string;
    /** 手动修改过受管字段的行：等待用户选择「覆盖」或「跳过」 */
    rows: Array<{ key: string; fields: ManagedField[]; result: ModelParamResult; before: ModelEntry }>;
    /** 本批已静默应用的行在生成前的快照，覆盖后合并进同一次撤销 */
    snapshot: Map<string, ModelEntry>;
    applied: number;
    extras: string[];
  } | null>(null);
  const documentRef = useRef<ConfigDocument | null>(documentData);
  documentRef.current = documentData;

  // Shared success handling for both sources
  const applyLoadedDocument = useCallback((doc: ConfigDocument) => {
    setDocumentData(doc);
    setDirty(false);
    setConflictMessage(null);
    setCcswitchNoticesOpen(true);
    setCheckedProviderKeys([]);
    setCheckedModelKeys([]);
    setSelectedProviderKey((prev) => {
      if (prev && doc.providers.some((p) => p.key === prev)) return prev;
      return doc.providers[0]?.key ?? null;
    });
  }, []);

  const loadConfigAtPath = useCallback(
    async (targetPath?: string | null) => {
      setLoadError(null);
      setLoadErrorCode(null);
      try {
        const doc = await bridge.loadConfig(targetPath ?? null);
        applyLoadedDocument(doc);
        setPathInput(doc.path);
        const refreshedSettings = await bridge.getSettings();
        setSettings(refreshedSettings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "加载配置文件失败";
        setLoadError(msg);
        setLoadErrorCode(null);
        setShowPathBar(true);
      }
    },
    [applyLoadedDocument],
  );

  const loadCcswitch = useCallback(async () => {
    setLoadError(null);
    setLoadErrorCode(null);
    try {
      const doc = await bridge.loadCcswitch();
      applyLoadedDocument(doc);
    } catch (err) {
      // Path bar does not apply to the database source
      setDocumentData(null);
      setLoadError(err instanceof Error ? err.message : "加载 CC Switch 配置失败");
      setLoadErrorCode(err instanceof BridgeError ? err.code : null);
    }
  }, [applyLoadedDocument]);

  // One entry point that routes by source
  const loadDocument = useCallback(
    async (source: ConfigSource, targetPath?: string | null) => {
      if (source === "ccswitch") {
        await loadCcswitch();
      } else {
        await loadConfigAtPath(targetPath);
      }
    },
    [loadCcswitch, loadConfigAtPath],
  );

  // Reload whatever the current source is
  const reloadCurrent = useCallback(
    (fallbackPath?: string | null) =>
      loadDocument(configSource, fallbackPath ?? documentData?.path ?? pathInput),
    [configSource, documentData?.path, loadDocument, pathInput],
  );

  // Initial Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingInit(true);
      try {
        const [info, loadedSettings, meta] = await Promise.all([
          bridge.getAppInfo(),
          bridge.getSettings(),
          bridge.getMetadataStatus(),
        ]);
        if (cancelled) return;
        setAppInfo(info);
        setSettings(loadedSettings);
        setMetadataStatus(meta);
        setSplitRatio(loadedSettings.splitRatio ?? 0.4);
        setActivePage(loadedSettings.activePage || "providers");
        const source: ConfigSource =
          loadedSettings.configSource === "ccswitch" ? "ccswitch" : "opencode";
        setConfigSource(source);
        await loadDocument(source, loadedSettings.lastConfigPath);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "初始化应用失败");
          setLoadErrorCode(null);
          setShowPathBar(true);
        }
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocument]);

  const handleChangeSource = useCallback(
    async (next: ConfigSource) => {
      if (next === configSource) return;
      if (dirty && !window.confirm("当前有未保存的修改，切换来源将丢弃这些修改，是否继续？")) {
        return;
      }
      setConfigSource(next);
      setShowPathBar(false);
      try {
        setSettings(await bridge.updateSettings({ configSource: next }));
      } catch (err) {
        notify(err instanceof Error ? err.message : "保存配置来源失败", "warning");
      }
      await loadDocument(next, next === "opencode" ? settings?.lastConfigPath ?? null : null);
    },
    [configSource, dirty, loadDocument, notify, settings?.lastConfigPath],
  );

  const selectedProvider = useMemo<ProviderEntry | null>(() => {
    if (!documentData || !selectedProviderKey) return null;
    return documentData.providers.find((p) => p.key === selectedProviderKey) ?? null;
  }, [documentData, selectedProviderKey]);

  // ---------------------------------------------------------------------------
  // 参数生成（backend/param_templates.py）：受管字段 variants / interleaved / temperature
  // ---------------------------------------------------------------------------

  /** 把生成结果套到指定提供商下的模型（基于最新 state，保留期间的其它修改） */
  const applyParamResults = useCallback(
    (providerKey: string, results: Map<string, ModelParamResult>) => {
      if (results.size === 0) return;
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) =>
                p.key !== providerKey
                  ? p
                  : {
                      ...p,
                      models: p.models.map((m) => {
                        const r = results.get(m.key);
                        return r ? applyParamResult(m, r) : m;
                      }),
                    },
              ),
            }
          : null,
      );
      setDirty(true);
    },
    [],
  );

  /** 撤销：只恢复受管字段，协议修改等其它改动保持不变 */
  const restoreManagedFields = useCallback(
    (providerKey: string, snapshot: Map<string, ModelEntry>) => {
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) =>
                p.key !== providerKey
                  ? p
                  : {
                      ...p,
                      models: p.models.map((m) => {
                        const s = snapshot.get(m.key);
                        return s
                          ? { ...m, variants: s.variants, interleaved: s.interleaved, temperature: s.temperature }
                          : m;
                      }),
                    },
              ),
            }
          : null,
      );
      setDirty(true);
    },
    [],
  );

  const finishParamRun = useCallback(
    (providerKey: string, snapshot: Map<string, ModelEntry>, applied: number, extras: string[]) => {
      const parts = applied > 0 ? [`已为 ${applied} 个模型生成参数`, ...extras] : extras;
      if (parts.length === 0) return;
      notify(
        parts.join("；"),
        applied > 0 ? "success" : "warning",
        applied > 0
          ? {
              label: "撤销",
              onClick: () => {
                restoreManagedFields(providerKey, snapshot);
                notify("已撤销本次参数生成", "info");
              },
            }
          : undefined,
      );
    },
    [notify, restoreManagedFields],
  );

  /**
   * 生成并应用参数。smart=true 用于协议变更：旧协议模板与当前受管字段一致的行静默重生成，
   * 其余（用户手改过的）行汇总后弹一次确认框。smart=false 直接应用（添加模型、「生成参数」按钮）。
   */
  const runParamJobs = useCallback(
    async (providerKey: string, jobs: ParamJob[], smart: boolean) => {
      if (jobs.length === 0) return;
      setGeneratingParams(true);
      try {
        const requests: ModelParamRequest[] = [];
        for (const job of jobs) {
          requests.push({ modelKey: job.key, modelId: job.modelId, providerHint: providerKey, npm: job.newNpm });
          if (smart) {
            requests.push({ modelKey: job.key, modelId: job.modelId, providerHint: providerKey, npm: job.oldNpm });
          }
        }
        const results = await bridge.generateModelParams(requests);
        const provider = documentRef.current?.providers.find((p) => p.key === providerKey);
        if (!provider) return;
        const modelMap = new Map(provider.models.map((m) => [m.key, m] as const));
        const silent = new Map<string, ModelParamResult>();
        const snapshot = new Map<string, ModelEntry>();
        const handEdited: Array<{ key: string; fields: ManagedField[]; result: ModelParamResult; before: ModelEntry }> = [];
        let unmatched = 0;
        let unsupported = 0;
        let unchanged = 0;
        jobs.forEach((job, idx) => {
          const next = results[smart ? idx * 2 : idx];
          const old = smart ? results[idx * 2 + 1] : undefined;
          const model = modelMap.get(job.key);
          if (!model || !next) return;
          if (next.status === "unmatched") {
            unmatched += 1;
            return;
          }
          if (next.status === "unsupported_npm") unsupported += 1;
          const fields = diffManagedFields(model, applyParamResult(model, next));
          if (fields.length === 0) {
            unchanged += 1;
            return;
          }
          if (!old || matchesParamTemplate(model, old)) {
            silent.set(job.key, next);
            snapshot.set(job.key, model);
          } else {
            handEdited.push({ key: job.key, fields, result: next, before: model });
          }
        });
        const extras: string[] = [];
        if (unmatched > 0) extras.push(`${unmatched} 个模型未匹配到模型库，未生成参数`);
        if (unsupported > 0) extras.push(`${unsupported} 个模型的协议不在翻译表中，未生成变体`);
        if (!smart && silent.size === 0 && unmatched === 0 && unchanged > 0) {
          extras.push("所选模型的参数已与模型库一致");
        }
        applyParamResults(providerKey, silent);
        if (handEdited.length > 0) {
          setParamConfirm({ providerKey, rows: handEdited, snapshot, applied: silent.size, extras });
        } else {
          finishParamRun(providerKey, snapshot, silent.size, extras);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : "生成参数失败", "error");
      } finally {
        setGeneratingParams(false);
      }
    },
    [applyParamResults, finishParamRun, notify],
  );

  // 协议变更合并成一批（一次粘贴 / 一次弹窗保存），在当前事件结束后统一处理
  const protocolQueueRef = useRef<{ providerKey: string; jobs: Map<string, ParamJob> } | null>(null);
  const queueProtocolChange = useCallback(
    (providerKey: string, job: ParamJob) => {
      const queued = protocolQueueRef.current;
      if (queued && queued.providerKey === providerKey) {
        const existing = queued.jobs.get(job.key);
        // 同一行多次变更：保留最早的旧协议，用于判断是否手改过
        queued.jobs.set(job.key, existing ? { ...job, oldNpm: existing.oldNpm } : job);
        return;
      }
      if (queued) void runParamJobs(queued.providerKey, [...queued.jobs.values()], true);
      protocolQueueRef.current = { providerKey, jobs: new Map([[job.key, job]]) };
      window.setTimeout(() => {
        const current = protocolQueueRef.current;
        protocolQueueRef.current = null;
        if (current) {
          // 新旧协议相同的行（改了又改回）无需处理
          const jobs = [...current.jobs.values()].filter((j) => j.oldNpm !== j.newNpm);
          void runParamJobs(current.providerKey, jobs, true);
        }
      }, 0);
    },
    [runParamJobs],
  );

  // Switching provider clears model-row checks
  const handleSelectProvider = useCallback(
    (key: string) => {
      if (key !== selectedProviderKey) {
        setSelectedProviderKey(key);
        setCheckedModelKeys([]);
      }
    },
    [selectedProviderKey],
  );

  // Save flow (with mtimeNs update and conflict handling)
  const handleSaveConfig = useCallback(
    async (force = false) => {
      if (!documentData) return;
      setSaving(true);
      try {
        const saved = await bridge.saveConfig(documentData, force);
        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                path: saved.path,
                exists: true,
                mtimeNs: saved.mtimeNs,
              }
            : null,
        );
        setDirty(false);
        setConflictMessage(null);
        if (documentData.source === "ccswitch") {
          notify(
            `已保存到 CC Switch 数据库并同步 opencode.json（数据库备份：${saved.backupPath ?? "无"}）`,
            "success",
          );
        } else {
          notify(
            saved.backupPath
              ? `配置已保存（已自动生成备份 ${saved.backupPath}）`
              : "配置已保存",
            "success",
          );
        }
      } catch (err) {
        if (err instanceof BridgeError && err.code === "conflict") {
          setConflictMessage(err.message);
        } else {
          notify(
            err instanceof Error ? err.message : "保存配置文件失败",
            "error",
          );
        }
      } finally {
        setSaving(false);
      }
    },
    [documentData, notify],
  );

  // Global Ctrl+S / Cmd+S shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveConfig(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveConfig]);

  // File Picker with browser fallback
  const handlePickConfigFile = async () => {
    try {
      const picked = await bridge.pickConfigFile();
      if (!picked) return;
      await loadConfigAtPath(picked.path);
    } catch (err) {
      if (err instanceof BridgeError && err.code === "dialog_unavailable") {
        setShowPathBar(true);
        notify("当前浏览器模式不支持原生文件对话框，请在下方路径栏输入配置文件路径", "info");
      } else {
        notify(err instanceof Error ? err.message : "打开文件对话框失败", "error");
      }
    }
  };

  // CC Switch database newer than the verified range: the user may skip the check for this version
  const handleSkipSchemaCheck = async () => {
    if (
      !window.confirm(
        "本工具尚未验证该版本的 CC Switch 数据库，跳过检查后读写可能出错。保存前会自动备份 cc-switch.db 与 opencode.json。仅对当前数据库版本生效，之后 CC Switch 再升级会重新提示。是否继续？",
      )
    ) {
      return;
    }
    try {
      setSettings(await bridge.acceptCcswitchSchema());
      await loadCcswitch();
    } catch (err) {
      notify(err instanceof Error ? err.message : "跳过版本检查失败", "error");
    }
  };

  // Metadata refresh, reload local cache & clear
  const handleRefreshMetadata = async (sourceId?: string | null) => {
    setRefreshingMeta(true);
    setMetaRefreshError(null);
    try {
      const status = await bridge.refreshMetadata(sourceId ?? null);
      setMetadataStatus(status);
      notify(
        `模型库已更新（${status.modelCount} 个模型，${formatUpdatedAt(status.updatedAt)}）`,
        "success",
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "更新模型库失败";
      setMetaRefreshError(errMsg);
      notify(errMsg, "error");
    } finally {
      setRefreshingMeta(false);
    }
  };

  const handleReloadMetadataCache = async () => {
    setRefreshingMeta(true);
    try {
      const status = await bridge.reloadMetadataCache();
      setMetadataStatus(status);
      if (status.available) {
        setMetaRefreshError(null);
        notify(
          `已从本地缓存读取模型库（共 ${status.modelCount} 个模型）`,
          "success",
        );
      } else {
        const msg = status.message || "本地模型库缓存文件不存在或格式无效";
        setMetaRefreshError(msg);
        notify(msg, "warning");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "重新读取本地模型库失败";
      setMetaRefreshError(errMsg);
      notify(errMsg, "error");
    } finally {
      setRefreshingMeta(false);
    }
  };

  const handleClearMetadataCache = async () => {
    setRefreshingMeta(true);
    setMetaRefreshError(null);
    try {
      const status = await bridge.clearMetadataCache();
      setMetadataStatus(status);
      notify("已清空本地模型库缓存", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "清空缓存失败", "error");
    } finally {
      setRefreshingMeta(false);
    }
  };

  // Splitter Drag (persist only on pointerup)
  const handleSplitterPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let latestRatio = splitRatio;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const raw = (moveEvent.clientY - rect.top) / rect.height;
      latestRatio = Math.min(0.8, Math.max(0.2, Number(raw.toFixed(3))));
      setSplitRatio(latestRatio);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      void bridge
        .updateSettings({ splitRatio: latestRatio })
        .then(setSettings)
        .catch(() => {});
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Column Width Commits (on pointerup)
  const handleProviderWidthsCommit = useCallback((widths: Record<string, number>) => {
    void bridge
      .updateSettings({ providerColumns: widths })
      .then(setSettings)
      .catch(() => {});
  }, []);

  const handleModelWidthsCommit = useCallback((widths: Record<string, number>) => {
    void bridge
      .updateSettings({ modelColumns: widths })
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Provider Mutations
  const handleUpdateProviderCell = useCallback(
    (
      providerKey: string,
      columnId: ProviderColumnId,
      value: string,
    ): { ok: boolean; error?: string } => {
      if (!documentData) return { ok: false };
      const target = documentData.providers.find((p) => p.key === providerKey);
      if (!target) return { ok: false };

      if (columnId === "key") {
        const nextKey = value.trim();
        if (!nextKey) {
          return { ok: false, error: "提供商标识符不能为空" };
        }
        if (
          nextKey !== providerKey &&
          documentData.providers.some((p) => p.key === nextKey)
        ) {
          return { ok: false, error: `提供商标识符「${nextKey}」已存在` };
        }
        if (nextKey === providerKey) return { ok: true };

        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === providerKey ? { ...p, key: nextKey } : p,
                ),
              }
            : null,
        );
        setSelectedProviderKey((prev) => (prev === providerKey ? nextKey : prev));
        setCheckedProviderKeys((prev) =>
          prev.map((k) => (k === providerKey ? nextKey : k)),
        );
        setDirty(true);
        return { ok: true };
      }

      const trimmed = value.trim();
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) => {
                if (p.key !== providerKey) return p;
                if (columnId === "name") {
                  return { ...p, name: trimmed || null };
                }
                if (columnId === "npm") {
                  return { ...p, npm: trimmed || null };
                }
                if (columnId === "baseURL") {
                  return {
                    ...p,
                    options: { ...p.options, baseURL: trimmed || null },
                  };
                }
                return p;
              }),
            }
          : null,
      );
      setDirty(true);
      return { ok: true };
    },
    [documentData],
  );

  const handleAddProvider = () => {
    if (!documentData) return;
    const newProvider = createEmptyProvider(documentData.providers.map((p) => p.key));
    setDocumentData((prev) =>
      prev
        ? {
            ...prev,
            providers: [...prev.providers, newProvider],
          }
        : null,
    );
    setSelectedProviderKey(newProvider.key);
    setCheckedModelKeys([]);
    setDirty(true);
  };

  const handleDeleteProviders = (keysToDelete: string[]) => {
    if (!documentData || keysToDelete.length === 0) return;
    const removeSet = new Set(keysToDelete);
    const remaining = documentData.providers.filter((p) => !removeSet.has(p.key));
    setDocumentData((prev) => (prev ? { ...prev, providers: remaining } : null));
    setCheckedProviderKeys((prev) => prev.filter((k) => !removeSet.has(k)));
    if (selectedProviderKey && removeSet.has(selectedProviderKey)) {
      setSelectedProviderKey(remaining[0]?.key ?? null);
      setCheckedModelKeys([]);
    }
    setDirty(true);
  };

  // Model Mutations
  const handleUpdateModelCell = useCallback(
    (
      modelKey: string,
      columnId: ModelColumnId,
      value: string,
    ): { ok: boolean; error?: string } => {
      if (!documentData || !selectedProvider) return { ok: false };
      const targetModel = selectedProvider.models.find((m) => m.key === modelKey);
      if (!targetModel) return { ok: false };

      if (columnId === "key") {
        const nextKey = value.trim();
        if (!nextKey) {
          return { ok: false, error: "模型标识符不能为空" };
        }
        if (
          nextKey !== modelKey &&
          selectedProvider.models.some((m) => m.key === nextKey)
        ) {
          return { ok: false, error: `模型标识符「${nextKey}」在当前提供商下已存在` };
        }
        if (nextKey === modelKey) return { ok: true };

        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === selectedProvider.key
                    ? {
                        ...p,
                        models: p.models.map((m) =>
                          m.key === modelKey ? { ...m, key: nextKey } : m,
                        ),
                      }
                    : p,
                ),
              }
            : null,
        );
        setCheckedModelKeys((prev) =>
          prev.map((k) => (k === modelKey ? nextKey : k)),
        );
        setDirty(true);
        return { ok: true };
      }

      if (columnId === "npm") {
        // 空值 = 清除模型级覆盖，继承提供商 npm
        const nextNpm = normalizeNpmInput(value) || null;
        if ((targetModel.provider?.npm ?? null) === nextNpm) return { ok: true };
        const oldEffective = effectiveNpm(targetModel, selectedProvider.npm);
        const newEffective = effectiveNpm(
          { ...targetModel, provider: { ...targetModel.provider, npm: nextNpm } },
          selectedProvider.npm,
        );
        if (oldEffective !== newEffective) {
          queueProtocolChange(selectedProvider.key, {
            key: modelKey,
            modelId: targetModel.id,
            oldNpm: oldEffective,
            newNpm: newEffective,
          });
        }
        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === selectedProvider.key
                    ? {
                        ...p,
                        models: p.models.map((m) =>
                          m.key === modelKey
                            ? { ...m, provider: { ...m.provider, npm: nextNpm } }
                            : m,
                        ),
                      }
                    : p,
                ),
              }
            : null,
        );
        setDirty(true);
        return { ok: true };
      }

      if (columnId === "context" || columnId === "output") {
        const trimmed = value.trim().replace(/,/g, "");
        let numVal: number | null = null;
        if (trimmed !== "") {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed < 0) {
            return { ok: false, error: "Token 限制必须是非负数字" };
          }
          numVal = Math.round(parsed);
        }
        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === selectedProvider.key
                    ? {
                        ...p,
                        models: p.models.map((m) =>
                          m.key === modelKey
                            ? {
                                ...m,
                                limit: { ...m.limit, [columnId]: numVal },
                              }
                            : m,
                        ),
                      }
                    : p,
                ),
              }
            : null,
        );
        setDirty(true);
        return { ok: true };
      }

      if (columnId === "inputModalities" || columnId === "outputModalities") {
        const dir = columnId === "inputModalities" ? "input" : "output";
        const parsedMods = parseModalitiesFromCell(value);
        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === selectedProvider.key
                    ? {
                        ...p,
                        models: p.models.map((m) => {
                          if (m.key !== modelKey) return m;
                          const nextIn =
                            dir === "input" ? parsedMods : (m.modalities?.input ?? []);
                          const nextOut =
                            dir === "output" ? parsedMods : (m.modalities?.output ?? []);
                          return {
                            ...m,
                            modalities:
                              nextIn.length > 0 || nextOut.length > 0
                                ? { input: nextIn, output: nextOut }
                                : null,
                          };
                        }),
                      }
                    : p,
                ),
              }
            : null,
        );
        setDirty(true);
        return { ok: true };
      }

      if (columnId === "variants") {
        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) =>
                  p.key === selectedProvider.key
                    ? {
                        ...p,
                        models: p.models.map((m) =>
                          m.key === modelKey
                            ? {
                                ...m,
                                variants: applyVariantsFromCell(m.variants, value),
                              }
                            : m,
                        ),
                      }
                    : p,
                ),
              }
            : null,
        );
        setDirty(true);
        return { ok: true };
      }

      return { ok: true };
    },
    [documentData, selectedProvider, queueProtocolChange],
  );

  const handleToggleModelModality = useCallback(
    (
      modelKey: string,
      direction: "input" | "output",
      modality: string,
      checked: boolean,
    ) => {
      if (!selectedProvider) return;
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) => {
                if (p.key !== selectedProvider.key) return p;
                return {
                  ...p,
                  models: p.models.map((m) => {
                    if (m.key !== modelKey) return m;
                    const nextIn =
                      direction === "input"
                        ? toggleKnownModality(m.modalities?.input, modality, checked)
                        : (m.modalities?.input ?? []);
                    const nextOut =
                      direction === "output"
                        ? toggleKnownModality(m.modalities?.output, modality, checked)
                        : (m.modalities?.output ?? []);
                    return {
                      ...m,
                      modalities:
                        nextIn.length > 0 || nextOut.length > 0
                          ? { input: nextIn, output: nextOut }
                          : null,
                    };
                  }),
                };
              }),
            }
          : null,
      );
      setDirty(true);
    },
    [selectedProvider],
  );

  const handleToggleModelVariant = useCallback(
    (modelKey: string, variantKey: string, checked: boolean) => {
      if (!selectedProvider) return;
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) => {
                if (p.key !== selectedProvider.key) return p;
                return {
                  ...p,
                  models: p.models.map((m) =>
                    m.key === modelKey
                      ? {
                          ...m,
                          variants: toggleVariantKey(m.variants, variantKey, checked),
                        }
                      : m,
                  ),
                };
              }),
            }
          : null,
      );
      setDirty(true);
    },
    [selectedProvider],
  );

  const handleApplySelectionDefaults = useCallback(
    async (rowIds: string[], columnIds: string[]) => {
      if (!selectedProvider || rowIds.length === 0 || columnIds.length === 0) return;
      setApplyingDefaults(true);
      try {
        const matchedList = await bridge.matchModelsDefaults(
          rowIds.map((modelKey) => ({
            modelKey,
            providerHint: selectedProvider.key,
          })),
        );
        const defaultsByRow = new Map(
          matchedList.map((d) => [d.modelKey, d] as const),
        );
        const matchedCount = matchedList.filter((d) => d.found).length;
        if (matchedCount === 0) {
          notify(
            metadataStatus?.available
              ? "所选模型在本地模型库中未找到匹配的默认配置"
              : "本地模型库尚未下载，请先点击顶部「更新模型库」",
            "warning",
          );
          return;
        }

        setDocumentData((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((p) => {
                  if (p.key !== selectedProvider.key) return p;
                  return {
                    ...p,
                    models: p.models.map((m) => {
                      const def = defaultsByRow.get(m.key);
                      if (!def || !def.found) return m;
                      return applyDefaultsToModelColumns(m, columnIds, def);
                    }),
                  };
                }),
              }
            : null,
        );
        setDirty(true);
        notify(`已将 ${matchedCount} 个模型的所选列重置为默认值`, "success");
      } catch (err) {
        notify(
          err instanceof Error ? err.message : "匹配默认值失败",
          "error",
        );
      } finally {
        setApplyingDefaults(false);
      }
    },
    [selectedProvider, metadataStatus, notify],
  );

  const handleAddBlankModel = () => {
    if (!selectedProvider) return;
    const newModel = createEmptyModel(selectedProvider.models.map((m) => m.key));
    setDocumentData((prev) =>
      prev
        ? {
            ...prev,
            providers: prev.providers.map((p) =>
              p.key === selectedProvider.key
                ? { ...p, models: [...p.models, newModel] }
                : p,
            ),
          }
        : null,
    );
    setDirty(true);
  };

  const handleAddModelsFromDialog = (newModels: ModelEntry[]) => {
    if (!selectedProvider || newModels.length === 0) {
      setAddModelsOpen(false);
      return;
    }
    const existingSet = new Set(selectedProvider.models.map((m) => m.key));
    const filtered = newModels.filter((m) => !existingSet.has(m.key));
    if (filtered.length > 0) {
      setDocumentData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) =>
                p.key === selectedProvider.key
                  ? { ...p, models: [...p.models, ...filtered] }
                  : p,
              ),
            }
          : null,
      );
      setDirty(true);
      notify(`已成功添加 ${filtered.length} 个模型`, "success");
      // 新加入的模型自动按 models.dev × 协议生成参数
      const providerNpm = selectedProvider.npm;
      void runParamJobs(
        selectedProvider.key,
        filtered.map((m) => {
          const npm = effectiveNpm(m, providerNpm);
          return { key: m.key, modelId: m.id, oldNpm: npm, newNpm: npm };
        }),
        false,
      );
    }
    setAddModelsOpen(false);
  };

  // 工具栏「生成参数」：对已勾选的行按当前协议直接重新生成
  const handleGenerateParams = (keys: string[]) => {
    if (!selectedProvider || keys.length === 0) return;
    const keySet = new Set(keys);
    void runParamJobs(
      selectedProvider.key,
      selectedProvider.models
        .filter((m) => keySet.has(m.key))
        .map((m) => {
          const npm = effectiveNpm(m, selectedProvider.npm);
          return { key: m.key, modelId: m.id, oldNpm: npm, newNpm: npm };
        }),
      false,
    );
  };

  // 确认框：覆盖手改行，或跳过它们（协议修改本身已生效）
  const resolveParamConfirm = (overwrite: boolean) => {
    if (!paramConfirm) return;
    const { providerKey, rows, snapshot, applied, extras } = paramConfirm;
    setParamConfirm(null);
    const merged = new Map(snapshot);
    let total = applied;
    if (overwrite) {
      const results = new Map<string, ModelParamResult>();
      for (const row of rows) {
        results.set(row.key, row.result);
        merged.set(row.key, row.before);
      }
      applyParamResults(providerKey, results);
      total += rows.length;
    } else {
      extras.push(`已跳过 ${rows.length} 个手动修改过的模型`);
    }
    finishParamRun(providerKey, merged, total, extras);
  };

  const handleDeleteModels = (keysToDelete: string[]) => {
    if (!selectedProvider || keysToDelete.length === 0) return;
    const removeSet = new Set(keysToDelete);
    setDocumentData((prev) =>
      prev
        ? {
            ...prev,
            providers: prev.providers.map((p) =>
              p.key === selectedProvider.key
                ? {
                    ...p,
                    models: p.models.filter((m) => !removeSet.has(m.key)),
                  }
                : p,
            ),
          }
        : null,
    );
    setCheckedModelKeys((prev) => prev.filter((k) => !removeSet.has(k)));
    setDirty(true);
  };

  // Save handlers from EditDialog (preserve row checks after batch edit)
  const handleSaveProvidersFromDialog = (updatedList: ProviderEntry[]) => {
    if (!documentData || !editDialogState || editDialogState.kind !== "provider") return;
    const originalKeys = editDialogState.targets.map((t) => t.key);
    const replacementMap = new Map<string, ProviderEntry>();
    originalKeys.forEach((origKey, idx) => {
      if (updatedList[idx]) {
        replacementMap.set(origKey, updatedList[idx]);
      }
    });

    setDocumentData((prev) =>
      prev
        ? {
            ...prev,
            providers: prev.providers.map((p) => replacementMap.get(p.key) ?? p),
          }
        : null,
    );

    if (!editDialogState.isBatch && originalKeys.length === 1 && updatedList[0]) {
      const oldKey = originalKeys[0];
      const newKey = updatedList[0].key;
      if (oldKey !== newKey) {
        setSelectedProviderKey((prev) => (prev === oldKey ? newKey : prev));
        setCheckedProviderKeys((prev) =>
          prev.map((k) => (k === oldKey ? newKey : k)),
        );
      }
    }

    setDirty(true);
    setEditDialogState(null);
  };

  const handleSaveModelsFromDialog = (updatedList: ModelEntry[]) => {
    if (!documentData || !editDialogState || editDialogState.kind !== "model") return;
    const provKey = editDialogState.providerKey;
    const originalKeys = editDialogState.targets.map((t) => t.key);
    // 协议变更：对比弹窗前后的生效 npm，交给批处理智能重生成
    const providerNpm = documentData.providers.find((p) => p.key === provKey)?.npm ?? null;
    editDialogState.targets.forEach((before, idx) => {
      const after = updatedList[idx];
      if (!after) return;
      const oldNpm = effectiveNpm(before, providerNpm);
      const newNpm = effectiveNpm(after, providerNpm);
      if (oldNpm !== newNpm) {
        queueProtocolChange(provKey, { key: after.key, modelId: after.id, oldNpm, newNpm });
      }
    });
    const replacementMap = new Map<string, ModelEntry>();
    originalKeys.forEach((origKey, idx) => {
      if (updatedList[idx]) {
        replacementMap.set(origKey, updatedList[idx]);
      }
    });

    setDocumentData((prev) =>
      prev
        ? {
            ...prev,
            providers: prev.providers.map((p) =>
              p.key === provKey
                ? {
                    ...p,
                    models: p.models.map((m) => replacementMap.get(m.key) ?? m),
                  }
                : p,
            ),
          }
        : null,
    );

    if (!editDialogState.isBatch && originalKeys.length === 1 && updatedList[0]) {
      const oldKey = originalKeys[0];
      const newKey = updatedList[0].key;
      if (oldKey !== newKey) {
        setCheckedModelKeys((prev) =>
          prev.map((k) => (k === oldKey ? newKey : k)),
        );
      }
    }

    setDirty(true);
    setEditDialogState(null);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: "background.default",
      }}
    >
      {/* Top Global Navigation & Action Bar */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        sx={{
          px: 2,
          minHeight: 44,
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #cbd5e1",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {/* Left: App Title */}
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 700, color: "primary.dark", whiteSpace: "nowrap" }}
          >
            {appInfo?.name || "OpenCode 配置编辑器"}
          </Typography>
          {appInfo?.version && (
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontFamily: MONOSPACE_FONT, whiteSpace: "nowrap" }}
            >
              v{appInfo.version}
            </Typography>
          )}
        </Stack>

        {/* Right: Config File, Metadata Source & Status, Save */}
        <Stack direction="row" alignItems="center" spacing={0.75}>
          {/* Config Source Selector (persisted). The help lives on a separate
              icon so its tooltip never covers the select or its menu. */}
          <Select
            size="small"
            value={configSource}
            inputProps={{ "aria-label": "配置来源" }}
            onChange={(e) => {
              const next: ConfigSource = e.target.value === "ccswitch" ? "ccswitch" : "opencode";
              void handleChangeSource(next);
            }}
            sx={{
              height: 26,
              fontSize: "0.75rem",
              "& .MuiSelect-select": {
                py: "2px !important",
                pl: "8px !important",
                pr: "24px !important",
              },
            }}
          >
            <MenuItem value="opencode" sx={{ fontSize: "0.78rem" }}>
              OpenCode
            </MenuItem>
            <MenuItem value="ccswitch" sx={{ fontSize: "0.78rem" }}>
              CC Switch
            </MenuItem>
          </Select>
          <Tooltip
            placement="bottom-end"
            title={
              <Box sx={{ lineHeight: 1.6 }}>
                OpenCode：直接编辑 opencode.json
                <br />
                CC Switch：编辑 CC Switch 数据库中的 OpenCode 提供商，并同步写入 opencode.json（需先退出 CC Switch）
              </Box>
            }
          >
            <IconButton size="small" aria-label="配置来源说明" sx={{ p: 0.25, ml: "2px !important" }}>
              <InfoOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          {/* Current Config File Badge (CC Switch: database, not clickable) */}
          {documentData && configSource === "ccswitch" && (
            <Tooltip
              title={
                <Box sx={{ lineHeight: 1.6 }}>
                  数据库: {documentData.path}
                  {documentData.livePath ? (
                    <>
                      <br />
                      同步写入: {documentData.livePath}
                    </>
                  ) : null}
                </Box>
              }
            >
              <Chip
                label={documentData.path.split(/[\\/]/).pop() || "cc-switch.db"}
                size="small"
                variant="outlined"
                sx={{ maxWidth: 180, fontFamily: MONOSPACE_FONT }}
              />
            </Tooltip>
          )}

          {/* Current Config File Badge */}
          {documentData && configSource === "opencode" && (
            <Tooltip title={`配置文件路径: ${documentData.path}（点击展开路径输入栏）`}>
              <Chip
                label={
                  documentData.exists
                    ? documentData.path.split(/[\\/]/).pop() || documentData.path
                    : `${documentData.path.split(/[\\/]/).pop() || documentData.path} (新建)`
                }
                size="small"
                variant="outlined"
                onClick={() => setShowPathBar((prev) => !prev)}
                sx={{
                  maxWidth: 180,
                  fontFamily: MONOSPACE_FONT,
                  "& .MuiChip-label": {
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                }}
              />
            </Tooltip>
          )}

          {configSource === "opencode" && (
            <Tooltip title="打开或切换配置文件">
              <Button
                size="small"
                variant="outlined"
                startIcon={<FolderOpenOutlinedIcon fontSize="small" />}
                onClick={handlePickConfigFile}
              >
                打开
              </Button>
            </Tooltip>
          )}

          <Tooltip title={configSource === "ccswitch" ? "从 CC Switch 数据库重新加载" : "从磁盘重新加载当前配置文件"}>
            <IconButton
              size="small"
              aria-label="重新加载配置"
              onClick={() => void reloadCurrent()}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Divider */}
          <Box sx={{ height: 18, borderLeft: "1px solid #cbd5e1", mx: 0.25 }} />

          {/* Metadata Source Selector, Compact Status & Refresh */}
          <Tooltip title="当前模型默认值库来源">
            <Select
              size="small"
              aria-label="模型库来源"
              value={metadataStatus?.activeSourceId || metadataStatus?.sourceId || "models.dev"}
              onChange={(e) => {
                const nextSourceId = e.target.value;
                void handleRefreshMetadata(nextSourceId);
              }}
              sx={{
                height: 26,
                fontSize: "0.75rem",
                fontFamily: MONOSPACE_FONT,
                "& .MuiSelect-select": {
                  py: "2px !important",
                  pl: "8px !important",
                  pr: "24px !important",
                },
              }}
            >
              {(metadataStatus?.sources && metadataStatus.sources.length > 0
                ? metadataStatus.sources
                : [
                    {
                      id: metadataStatus?.activeSourceId || metadataStatus?.sourceId || "models.dev",
                      sourceUrl: metadataStatus?.sourceUrl ?? null,
                      active: true,
                    },
                  ]
              ).map((src) => (
                <MenuItem key={src.id} value={src.id} sx={{ fontSize: "0.78rem", fontFamily: MONOSPACE_FONT }}>
                  {src.id}
                </MenuItem>
              ))}
            </Select>
          </Tooltip>

          <Tooltip
            title={
              metadataStatus?.available
                ? `来源: ${metadataStatus.sourceUrl} · 共 ${metadataStatus.modelCount} 个模型 · 缓存: ${metadataStatus.path}`
                : "尚未下载本地模型库缓存，点击右侧「更新」下载"
            }
          >
            <Chip
              label={
                metadataStatus?.available
                  ? `${formatUpdatedAt(metadataStatus.updatedAt)} (${metadataStatus.modelCount})`
                  : "未下载"
              }
              size="small"
              color={metadataStatus?.available ? "default" : "warning"}
              variant="outlined"
              sx={{ fontFamily: MONOSPACE_FONT }}
            />
          </Tooltip>

          <Tooltip title="同步更新当前模型库">
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={refreshingMeta}
                startIcon={
                  refreshingMeta ? (
                    <CircularProgress size={13} color="inherit" />
                  ) : (
                    <SyncIcon fontSize="small" />
                  )
                }
                onClick={() => void handleRefreshMetadata()}
              >
                更新
              </Button>
            </span>
          </Tooltip>

          {metadataStatus?.available && (
            <Tooltip title="清空已下载的模型库缓存">
              <IconButton
                size="small"
                aria-label="清空模型库缓存"
                disabled={refreshingMeta}
                onClick={handleClearMetadataCache}
              >
                <DeleteSweepOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {/* Divider */}
          <Box sx={{ height: 18, borderLeft: "1px solid #cbd5e1", mx: 0.25 }} />

          {/* Dirty Marker & Save Button */}
          {dirty && (
            <Chip
              icon={<WarningAmberRoundedIcon sx={{ fontSize: "14px !important" }} />}
              label="未保存"
              size="small"
              color="warning"
              variant="filled"
            />
          )}

          <Tooltip title="保存当前配置 (Ctrl+S)">
            <span>
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={saving || !documentData}
                startIcon={<SaveOutlinedIcon fontSize="small" />}
                onClick={() => void handleSaveConfig(false)}
              >
                {saving ? "保存中" : "保存"}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Metadata Manual Download Fallback Bar (Top Bar Area) */}
      {metaRefreshError && (
        <Alert
          severity="error"
          sx={{
            px: 2,
            py: 0.75,
            borderRadius: 0,
            borderBottom: "1px solid #cbd5e1",
            flexShrink: 0,
            alignItems: "center",
          }}
          onClose={() => setMetaRefreshError(null)}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={refreshingMeta}
                onClick={handleReloadMetadataCache}
              >
                已放好，重新读取
              </Button>
            </Stack>
          }
        >
          {(() => {
            const targetPath = splitCatalogPath(
              appInfo?.catalogCachePath ?? metadataStatus?.path,
            );
            return (
              <Box sx={{ wordBreak: "break-word", lineHeight: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  自动更新模型库失败：{metaRefreshError}
                </Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  您可手动访问{" "}
                  <Box
                    component="a"
                    href="https://models.dev/api.json"
                    target="_blank"
                    rel="noreferrer"
                    sx={{ fontFamily: MONOSPACE_FONT, color: "inherit", fontWeight: 600 }}
                  >
                    https://models.dev/api.json
                  </Box>{" "}
                  下载模型库文件，保存到目录{" "}
                  <Box component="code" sx={{ fontFamily: MONOSPACE_FONT, fontWeight: 600 }}>
                    {targetPath.dirPath}
                  </Box>{" "}
                  下并命名为{" "}
                  <Box component="code" sx={{ fontFamily: MONOSPACE_FONT, fontWeight: 600 }}>
                    {targetPath.fileName}
                  </Box>{" "}
                  （完整路径：
                  <Box component="code" sx={{ fontFamily: MONOSPACE_FONT, fontWeight: 600 }}>
                    {targetPath.filePath}
                  </Box>
                  ；若该文件夹不存在请先新建），随后点击右侧「已放好，重新读取」。
                </Typography>
              </Box>
            );
          })()}
        </Alert>
      )}

      {/* Collapsible File Path Input Bar (Browser fallback or quick path switch) */}
      {showPathBar && configSource === "opencode" && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={1}
          sx={{
            px: 2,
            py: 1,
            backgroundColor: "#f8fafc",
            borderBottom: "1px solid #cbd5e1",
            flexShrink: 0,
          }}
        >
          <TextField
            size="small"
            fullWidth
            label="配置文件路径 (opencode.json)"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void loadConfigAtPath(pathInput);
              }
            }}
            sx={{
              "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
            }}
          />
          {settings && settings.recentConfigPaths.length > 0 && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                最近:
              </Typography>
              {settings.recentConfigPaths.slice(0, 3).map((recentPath) => (
                <Chip
                  key={recentPath}
                  label={recentPath.split(/[\\/]/).pop() || recentPath}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setPathInput(recentPath);
                    void loadConfigAtPath(recentPath);
                  }}
                />
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => void loadConfigAtPath(pathInput)}
            >
              加载此路径
            </Button>
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => setShowPathBar(false)}
            >
              收起
            </Button>
          </Stack>
        </Stack>
      )}

      {/* CC Switch notices (dismissed per load) */}
      {configSource === "ccswitch" && documentData?.source === "ccswitch" && ccswitchNoticesOpen && (() => {
        const locked = documentData.lockedProviders ?? [];
        const drifted = documentData.driftedProviders ?? [];
        const notices = documentData.notices ?? [];
        if (
          !documentData.running &&
          !documentData.schemaUnverified &&
          locked.length === 0 &&
          drifted.length === 0 &&
          notices.length === 0
        ) {
          return null;
        }
        return (
          <Stack
            spacing={0.5}
            sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid #cbd5e1", flexShrink: 0 }}
          >
            {documentData.schemaUnverified && (
              <Alert severity="warning" sx={{ py: 0 }} onClose={() => setCcswitchNoticesOpen(false)}>
                已跳过版本检查：CC Switch 数据库为 v{documentData.schemaVersion}，本工具仅验证到 v{documentData.verifiedSchema}。如遇异常请更新本工具。
              </Alert>
            )}
            {documentData.running && (
              <Alert severity="warning" sx={{ py: 0 }} onClose={() => setCcswitchNoticesOpen(false)}>
                检测到 CC Switch 正在运行，保存前请完全退出 CC Switch（包括托盘）
              </Alert>
            )}
            {drifted.length > 0 && (
              <Alert severity="warning" sx={{ py: 0 }} onClose={() => setCcswitchNoticesOpen(false)}>
                以下提供商在 opencode.json 中与 CC Switch 数据库不一致，已按 opencode.json 载入（CC Switch 下次启动也会以它为准）：
                {drifted.join("、")}
              </Alert>
            )}
            {locked.length > 0 && (
              <Alert severity="info" sx={{ py: 0 }} onClose={() => setCcswitchNoticesOpen(false)}>
                以下条目由 CC Switch 管理或格式暂不支持，已隐藏且不会被修改：
                {locked.map((item) => (
                  <Typography key={item.key} variant="caption" component="div">
                    {item.name} ({item.key})：{item.reason}
                  </Typography>
                ))}
              </Alert>
            )}
            {notices.map((message) => (
              <Alert key={message} severity="info" sx={{ py: 0 }} onClose={() => setCcswitchNoticesOpen(false)}>
                {message}
              </Alert>
            ))}
          </Stack>
        );
      })()}

      {/* Load / JSON Error Banner */}
      {loadError && (
        <Alert
          severity="error"
          sx={{ m: 1.5, flexShrink: 0 }}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                color="inherit"
                size="small"
                onClick={() => void reloadCurrent(pathInput || null)}
              >
                重试加载
              </Button>
              {configSource === "ccswitch" && loadErrorCode === "ccswitch_newer" && (
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  onClick={() => void handleSkipSchemaCheck()}
                >
                  跳过版本检查并继续
                </Button>
              )}
            </Stack>
          }
        >
          {configSource === "ccswitch" ? "加载 CC Switch 配置失败：" : "加载配置文件失败："}
          {loadError}
        </Alert>
      )}

      {/* Main Content Area */}
      {loadingInit ? (
        <Stack
           sx={{ flex: 1 }}
          alignItems="center"
          justifyContent="center"
          spacing={1.5}
        >
          <CircularProgress size={28} />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            正在加载配置与工作区状态...
          </Typography>
        </Stack>
      ) : activePage === "providers" && documentData ? (
        <Box
          ref={splitContainerRef}
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Top Pane: ProviderTable (default 40%) */}
          <Box
            sx={{
              height: `${(splitRatio * 100).toFixed(1)}%`,
              minHeight: 140,
              overflow: "hidden",
            }}
          >
            <ProviderTable
              providers={documentData.providers}
              selectedProviderKey={selectedProviderKey}
              checkedKeys={checkedProviderKeys}
              columnWidths={settings?.providerColumns ?? {}}
              onSelectProvider={handleSelectProvider}
              onChangeCheckedKeys={setCheckedProviderKeys}
              onUpdateProviderCell={handleUpdateProviderCell}
              onAddProvider={handleAddProvider}
              onOpenSingleEdit={(provKey) => {
                const target = documentData.providers.find((p) => p.key === provKey);
                if (!target) return;
                setEditDialogState({
                  kind: "provider",
                  isBatch: false,
                  targets: [target],
                  existingKeys: documentData.providers.map((p) => p.key),
                });
              }}
              onOpenBatchEdit={() => {
                const targets = documentData.providers.filter((p) =>
                  checkedProviderKeys.includes(p.key),
                );
                if (targets.length === 0) return;
                setEditDialogState({
                  kind: "provider",
                  isBatch: targets.length > 1,
                  targets,
                  existingKeys: documentData.providers.map((p) => p.key),
                });
              }}
              onDeleteProviders={handleDeleteProviders}
              onColumnWidthsCommit={handleProviderWidthsCommit}
              onStatusMessage={notify}
            />
          </Box>

          {/* Draggable Horizontal Splitter Bar */}
          <Box
            onPointerDown={handleSplitterPointerDown}
            role="separator"
            aria-orientation="horizontal"
            aria-label="上下分栏高度调节手柄"
            sx={{
              height: 6,
              backgroundColor: "#e2e8f0",
              cursor: "row-resize",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background-color 150ms ease",
              "&:hover": {
                backgroundColor: "#93c5fd",
              },
            }}
          >
            <Box
              sx={{
                width: 36,
                height: 2,
                borderRadius: 1,
                backgroundColor: "#64748b",
              }}
            />
          </Box>

          {/* Bottom Pane: ModelTable (default 60%) */}
          <Box
            sx={{
              flex: 1,
              minHeight: 180,
              overflow: "hidden",
            }}
          >
            <ModelTable
              provider={selectedProvider}
              checkedKeys={checkedModelKeys}
              columnWidths={settings?.modelColumns ?? {}}
              applyingDefaults={applyingDefaults}
              onChangeCheckedKeys={setCheckedModelKeys}
              onUpdateModelCell={handleUpdateModelCell}
              onToggleModelModality={handleToggleModelModality}
              onToggleModelVariant={handleToggleModelVariant}
              onApplySelectionDefaults={handleApplySelectionDefaults}
              onGenerateParams={handleGenerateParams}
              generatingParams={generatingParams}
              onAddBlankModel={handleAddBlankModel}
              onOpenAddModelsDialog={() => setAddModelsOpen(true)}
              onOpenSingleEdit={(modelKey) => {
                if (!selectedProvider) return;
                const target = selectedProvider.models.find((m) => m.key === modelKey);
                if (!target) return;
                setEditDialogState({
                  kind: "model",
                  isBatch: false,
                  providerKey: selectedProvider.key,
                  targets: [target],
                  existingKeys: selectedProvider.models.map((m) => m.key),
                });
              }}
              onOpenBatchEdit={() => {
                if (!selectedProvider) return;
                const targets = selectedProvider.models.filter((m) =>
                  checkedModelKeys.includes(m.key),
                );
                if (targets.length === 0) return;
                setEditDialogState({
                  kind: "model",
                  isBatch: targets.length > 1,
                  providerKey: selectedProvider.key,
                  targets,
                  existingKeys: selectedProvider.models.map((m) => m.key),
                });
              }}
              onDeleteModels={handleDeleteModels}
              onColumnWidthsCommit={handleModelWidthsCommit}
              onStatusMessage={notify}
            />
          </Box>
        </Box>
      ) : null}

      {/* Detail / Batch Edit Dialog */}
      <EditDialog
        state={editDialogState}
        onClose={() => setEditDialogState(null)}
        onSaveProviders={handleSaveProvidersFromDialog}
        onSaveModels={handleSaveModelsFromDialog}
        modelProviderNpm={
          editDialogState?.kind === "model"
            ? documentData?.providers.find((p) => p.key === editDialogState.providerKey)?.npm ?? null
            : null
        }
      />

      {/* Add Models Dialog */}
      <AddModelsDialog
        open={addModelsOpen}
        provider={selectedProvider}
        metadataStatus={metadataStatus}
        catalogCachePath={appInfo?.catalogCachePath ?? metadataStatus?.path ?? null}
        onClose={() => setAddModelsOpen(false)}
        onAddModels={handleAddModelsFromDialog}
        onMetadataStatusChange={setMetadataStatus}
      />

      {/* Save Conflict Confirmation Dialog */}
      <Dialog
        open={Boolean(conflictMessage)}
        onClose={() => setConflictMessage(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>配置文件已被外部修改</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {conflictMessage}
          </Alert>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            磁盘上的配置文件在您打开后已被其它程序修改。建议重新加载最新文件以免覆盖外部更改；如确认以当前界面内容为准，可选择「强制覆盖保存」。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setConflictMessage(null)}
          >
            取消
          </Button>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => void reloadCurrent()}
          >
            重新加载外部文件
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => void handleSaveConfig(true)}
          >
            强制覆盖保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 参数重生成：手改行覆盖确认 */}
      <Dialog
        open={Boolean(paramConfirm)}
        onClose={() => resolveParamConfirm(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>以下模型的参数已被手动修改</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1.5, color: "text.secondary" }}>
            协议修改已生效。按新协议重新生成参数会覆盖下列模型的这些字段：
          </Typography>
          <Stack spacing={0.75}>
            {paramConfirm?.rows.map((row) => (
              <Stack key={row.key} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontFamily: MONOSPACE_FONT }}>
                  {row.key}
                </Typography>
                {row.fields.map((f) => (
                  <Chip key={f} label={MANAGED_FIELD_LABELS[f]} size="small" />
                ))}
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => resolveParamConfirm(false)}>跳过这些行</Button>
          <Button variant="contained" onClick={() => resolveParamConfirm(true)}>
            覆盖
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Toast Notification */}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => setToast(null)}
            action={
              toast.action ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    const run = toast.action?.onClick;
                    setToast(null);
                    run?.();
                  }}
                >
                  {toast.action.label}
                </Button>
              ) : undefined
            }
            sx={{ width: "100%" }}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
};
