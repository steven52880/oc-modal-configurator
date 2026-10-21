import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import { bridge } from "../api/bridge";
import type {
  CatalogModel,
  CatalogResult,
  MetadataStatus,
  ModelDefaults,
  ModelEntry,
  ProbeResult,
  ProviderEntry,
  RemoteModel,
} from "../types/domain";
import {
  createModelFromSource,
  formatNumberCompact,
  getPrefixColor,
  splitCatalogPath,
} from "../utils/modelHelpers";
import { MONOSPACE_FONT } from "../theme";

interface NormalizedCandidate {
  id: string;
  name: string | null;
  subLabel: string | null;
  defaults: ModelDefaults | CatalogModel | null;
}

interface NormalizedGroup {
  prefix: string;
  models: NormalizedCandidate[];
}

interface AddModelsDialogProps {
  open: boolean;
  provider: ProviderEntry | null;
  metadataStatus: MetadataStatus | null;
  catalogCachePath: string | null;
  onClose: () => void;
  onAddModels: (models: ModelEntry[]) => void;
  onMetadataStatusChange: (status: MetadataStatus) => void;
}

export const AddModelsDialog: React.FC<AddModelsDialogProps> = ({
  open,
  provider,
  metadataStatus,
  catalogCachePath,
  onClose,
  onAddModels,
  onMetadataStatusChange,
}) => {
  const [sourceTab, setSourceTab] = useState<"probe" | "catalog">("probe");

  // Remote probe state
  const [probing, setProbing] = useState<boolean>(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  // Catalog search state
  const [searching, setSearching] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogResult, setCatalogResult] = useState<CatalogResult | null>(null);
  const [catalogProviderId, setCatalogProviderId] = useState<string>("");
  const [catalogQuery, setCatalogQuery] = useState<string>("");

  // Metadata refresh / clear state
  const [refreshingMeta, setRefreshingMeta] = useState<boolean>(false);
  const [metaActionError, setMetaActionError] = useState<string | null>(null);

  // Selected candidate map: modelId -> NormalizedCandidate
  const [selectedMap, setSelectedMap] = useState<Record<string, NormalizedCandidate>>({});
  const [expandedPrefixes, setExpandedPrefixes] = useState<Record<string, boolean>>({});
  const [filterText, setFilterText] = useState<string>("");

  const existingIds = useMemo(
    () => new Set((provider?.models ?? []).map((m) => m.key)),
    [provider],
  );

  const runProbe = useCallback(async () => {
    if (!provider) return;
    const baseURL = provider.options.baseURL?.trim() ?? "";
    if (!baseURL) {
      setProbeResult(null);
      setProbeError(
        "当前提供商未配置 API 基础地址 (options.baseURL)，无法请求 /models 接口。请切换到「从本地模型库检索」或先填写提供商 URL。",
      );
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const res = await bridge.probeProviderModels(
        baseURL,
        provider.options.apiKey,
        provider.key,
      );
      setProbeResult(res);
    } catch (err) {
      setProbeResult(null);
      setProbeError(
        err instanceof Error ? err.message : "请求提供商 /models 接口失败",
      );
    } finally {
      setProbing(false);
    }
  }, [provider]);

  const runCatalogSearch = useCallback(
    async (
      overrideProviderId?: string,
      overrideQuery?: string,
      includeAll = false,
    ) => {
      const provId =
        overrideProviderId !== undefined ? overrideProviderId : catalogProviderId;
      const q = overrideQuery !== undefined ? overrideQuery : catalogQuery;
      setSearching(true);
      setCatalogError(null);
      try {
        const res = await bridge.searchCatalog(
          provId.trim() || null,
          q.trim() || null,
          includeAll,
        );
        setCatalogResult(res);
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : "检索本地模型库失败");
      } finally {
        setSearching(false);
      }
    },
    [catalogProviderId, catalogQuery],
  );

  // Reset and run initial probe when dialog opens
  useEffect(() => {
    if (!open || !provider) return;
    setSelectedMap({});
    setExpandedPrefixes({});
    setFilterText("");
    setMetaActionError(null);
    setCatalogProviderId("");
    setCatalogQuery("");
    setSourceTab("probe");
    void runProbe();
    void runCatalogSearch("", "", false);
  }, [open, provider?.key]);

  const handleSwitchToCatalog = () => {
    setSourceTab("catalog");
    if (!catalogResult) {
      void runCatalogSearch(catalogProviderId, catalogQuery, false);
    }
  };

  const handleRefreshMetadata = async (sourceId?: string | null) => {
    setRefreshingMeta(true);
    setMetaActionError(null);
    try {
      const status = await bridge.refreshMetadata(sourceId ?? null);
      onMetadataStatusChange(status);
      await runCatalogSearch(catalogProviderId, catalogQuery, false);
    } catch (err) {
      setMetaActionError(
        err instanceof Error ? err.message : "下载更新模型库失败",
      );
    } finally {
      setRefreshingMeta(false);
    }
  };

  const handleReloadMetadataCache = async () => {
    setRefreshingMeta(true);
    try {
      const status = await bridge.reloadMetadataCache();
      onMetadataStatusChange(status);
      if (status.available) {
        setMetaActionError(null);
        await runCatalogSearch(catalogProviderId, catalogQuery, false);
      } else {
        setMetaActionError(
          status.message || "本地模型库缓存文件不存在或格式无效",
        );
      }
    } catch (err) {
      setMetaActionError(
        err instanceof Error ? err.message : "重新读取本地模型库失败",
      );
    } finally {
      setRefreshingMeta(false);
    }
  };

  const handleClearMetadataCache = async () => {
    setRefreshingMeta(true);
    setMetaActionError(null);
    try {
      const status = await bridge.clearMetadataCache();
      onMetadataStatusChange(status);
      await runCatalogSearch("", "", false);
    } catch (err) {
      setMetaActionError(
        err instanceof Error ? err.message : "清空模型库缓存失败",
      );
    } finally {
      setRefreshingMeta(false);
    }
  };

  // Convert active source groups without regrouping
  const activeGroups = useMemo<NormalizedGroup[]>(() => {
    const keyword = filterText.trim().toLowerCase();
    if (sourceTab === "probe") {
      if (!probeResult) return [];
      return probeResult.groups
        .map((group) => {
          const seen = new Set<string>();
          const models: NormalizedCandidate[] = [];
          for (const item of group.models as RemoteModel[]) {
            if (seen.has(item.id)) continue;
            if (
              keyword &&
              !item.id.toLowerCase().includes(keyword) &&
              !(item.name ?? "").toLowerCase().includes(keyword)
            ) {
              continue;
            }
            seen.add(item.id);
            models.push({
              id: item.id,
              name: item.name ?? item.defaults?.name ?? null,
              subLabel: item.ownedBy ? `所属: ${item.ownedBy}` : null,
              defaults: item.defaults,
            });
          }
          return { prefix: group.prefix, models };
        })
        .filter((g) => g.models.length > 0);
    }

    if (!catalogResult) return [];
    return catalogResult.groups
      .map((group) => {
        const seen = new Set<string>();
        const models: NormalizedCandidate[] = [];
        for (const item of group.models) {
          if (seen.has(item.id)) continue;
          if (
            keyword &&
            !item.id.toLowerCase().includes(keyword) &&
            !(item.name ?? "").toLowerCase().includes(keyword)
          ) {
            continue;
          }
          seen.add(item.id);
          models.push({
            id: item.id,
            name: item.name,
            subLabel: `来源提供商: ${item.providerId}`,
            defaults: item,
          });
        }
        return { prefix: group.prefix, models };
      })
      .filter((g) => g.models.length > 0);
  }, [sourceTab, probeResult, catalogResult, filterText]);

  const toggleCandidate = (candidate: NormalizedCandidate, checked: boolean) => {
    if (existingIds.has(candidate.id)) return;
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (checked) {
        next[candidate.id] = candidate;
      } else {
        delete next[candidate.id];
      }
      return next;
    });
  };

  const toggleGroup = (group: NormalizedGroup, checked: boolean) => {
    const addable = group.models.filter((m) => !existingIds.has(m.id));
    if (addable.length === 0) return;
    setSelectedMap((prev) => {
      const next = { ...prev };
      for (const item of addable) {
        if (checked) {
          next[item.id] = item;
        } else {
          delete next[item.id];
        }
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      for (const group of activeGroups) {
        for (const item of group.models) {
          if (!existingIds.has(item.id)) {
            next[item.id] = item;
          }
        }
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedMap({});
  };

  const selectedList = useMemo(() => Object.values(selectedMap), [selectedMap]);

  const handleConfirmAdd = () => {
    const newEntries: ModelEntry[] = [];
    for (const candidate of selectedList) {
      if (existingIds.has(candidate.id)) continue;
      newEntries.push(
        createModelFromSource(candidate.id, candidate.name, candidate.defaults),
      );
    }
    onAddModels(newEntries);
  };

  if (!open || !provider) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="add-models-dialog-title"
    >
      <DialogTitle id="add-models-dialog-title">
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" component="span">
              添加模型到提供商：{provider.name || provider.key}
            </Typography>
            <Chip
              label={`已有 ${provider.models.length} 个模型`}
              size="small"
              variant="outlined"
            />
          </Stack>
          <IconButton aria-label="关闭添加模型弹窗" onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      {/* Source Tabs */}
      <Box sx={{ px: 2, backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <Tabs
          value={sourceTab}
          onChange={(_, val) => {
            setSourceTab(val);
            if (val === "catalog" && !catalogResult) {
              void runCatalogSearch(catalogProviderId, catalogQuery, false);
            }
          }}
        >
          <Tab
            value="probe"
            icon={<CloudDownloadOutlinedIcon sx={{ fontSize: 17 }} />}
            iconPosition="start"
            label="从提供商接口拉取 (/models)"
          />
          <Tab
            value="catalog"
            icon={<StorageOutlinedIcon sx={{ fontSize: 17 }} />}
            iconPosition="start"
            label="从本地模型库检索 (models.dev)"
          />
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ minHeight: 420 }}>
        {/* Metadata Status & Refresh Bar */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
          spacing={1}
          sx={{
            mb: 1.5,
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
              模型默认值库：
            </Typography>
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
            {metadataStatus?.available ? (
              <Chip
                label={`已缓存 ${metadataStatus.modelCount} 个模型 · 更新于 ${metadataStatus.updatedAt ?? "未知时间"}`}
                size="small"
                color="success"
                variant="outlined"
              />
            ) : (
              <Chip
                label={metadataStatus?.message || "尚未下载"}
                size="small"
                color="warning"
                variant="outlined"
              />
            )}
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center">
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
              {refreshingMeta ? "同步中..." : "更新模型库"}
            </Button>
            {metadataStatus?.available && (
              <Tooltip title="清空已下载的模型库">
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  disabled={refreshingMeta}
                  startIcon={<DeleteSweepOutlinedIcon fontSize="small" />}
                  onClick={handleClearMetadataCache}
                >
                  清空缓存
                </Button>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        {metaActionError && (
          <Alert
            severity="error"
            sx={{ mb: 1.5, alignItems: "center" }}
            onClose={() => setMetaActionError(null)}
            action={
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={refreshingMeta}
                onClick={handleReloadMetadataCache}
              >
                已放好，重新读取
              </Button>
            }
          >
            {(() => {
              const targetPath = splitCatalogPath(
                catalogCachePath ?? metadataStatus?.path,
              );
              return (
                <Box sx={{ wordBreak: "break-word", lineHeight: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    自动更新模型库失败：{metaActionError}
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

        {/* Tab 1: Remote Probe Controls & States */}
        {sourceTab === "probe" && (
          <Box sx={{ mb: 1.5 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontFamily: MONOSPACE_FONT }}
              >
                请求地址:{" "}
                {provider.options.baseURL
                  ? `${provider.options.baseURL.replace(/\/+$/, "")}/models`
                  : "未配置 baseURL"}
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  placeholder="在拉取结果中筛选模型..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  sx={{ width: 200 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={probing}
                  startIcon={<RefreshIcon fontSize="small" />}
                  onClick={runProbe}
                >
                  重新拉取
                </Button>
              </Stack>
            </Stack>

            {probing && (
              <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 5 }}>
                <CircularProgress size={26} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  正在请求提供商 /models 接口并匹配默认配置...
                </Typography>
              </Stack>
            )}

            {!probing && probeError && (
              <Alert
                severity="warning"
                sx={{ mb: 1.5 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    onClick={handleSwitchToCatalog}
                  >
                    从本地模型库检索
                  </Button>
                }
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  无法从提供商接口拉取模型：{probeError}
                </Typography>
                <Typography variant="caption">
                  您可以点击右侧按钮切换到「从本地模型库检索 (models.dev)」按提供商或关键词添加模型。
                </Typography>
              </Alert>
            )}
          </Box>
        )}

        {/* Tab 2: Local Catalog Search Controls & States */}
        {sourceTab === "catalog" && (
          <Box sx={{ mb: 1.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
              sx={{ mb: 1.5 }}
            >
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="catalog-provider-select-label">
                  按模型库提供商筛选
                </InputLabel>
                <Select
                  labelId="catalog-provider-select-label"
                  label="按模型库提供商筛选"
                  value={catalogProviderId}
                  onChange={(e) => {
                    const nextProv = e.target.value;
                    setCatalogProviderId(nextProv);
                    void runCatalogSearch(nextProv, catalogQuery, false);
                  }}
                >
                  <MenuItem value="">全部提供商（需配合关键词或点击加载全部）</MenuItem>
                  {(catalogResult?.providers ?? []).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} ({p.id}) · {p.modelCount} 个模型
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                fullWidth
                label="搜索模型标识符或名称"
                placeholder="例如：deepseek、gpt-5、claude、gemini"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runCatalogSearch(catalogProviderId, catalogQuery, false);
                  }
                }}
              />

              <Button
                size="small"
                variant="contained"
                disabled={searching}
                startIcon={<SearchIcon fontSize="small" />}
                onClick={() => void runCatalogSearch(catalogProviderId, catalogQuery, false)}
              >
                检索
              </Button>

              <Button
                size="small"
                variant="outlined"
                disabled={searching}
                onClick={() => void runCatalogSearch(catalogProviderId, catalogQuery, true)}
              >
                列出全部模型
              </Button>
            </Stack>

            {catalogError && (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                {catalogError}
              </Alert>
            )}

            {catalogResult?.hint === "catalog_empty" && (
              <Alert
                severity="warning"
                sx={{ mb: 1.5 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    disabled={refreshingMeta}
                    onClick={() => void handleRefreshMetadata()}
                  >
                    立即下载模型库
                  </Button>
                }
              >
                本地模型库尚未下载。请点击「更新模型库」，从 models.dev 下载后再检索。
              </Alert>
            )}

            {catalogResult?.hint === "need_query" && (
              <Alert
                severity="info"
                sx={{ mb: 1.5 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    onClick={() => void runCatalogSearch(catalogProviderId, catalogQuery, true)}
                  >
                    加载全部 ({catalogResult.total})
                  </Button>
                }
              >
                本地模型库共有 {catalogResult.total} 条模型记录。请先选择「模型库提供商」或输入搜索关键词，也可点击右侧「加载全部」查看完整列表。
              </Alert>
            )}

            {catalogResult?.truncated && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                匹配结果较多（共 {catalogResult.total} 条），当前展示前 800 条。您可以输入更精确的关键词或点击「列出全部模型」。
              </Alert>
            )}
          </Box>
        )}

        {/* Group Selection Summary Bar */}
        {activeGroups.length > 0 && (
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1 }}
          >
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              共 {activeGroups.length} 个前缀分组（按模型第一段名称自动归类，勾选组头可整组选择）
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="text" onClick={handleSelectAllVisible}>
                全选当前可见模型
              </Button>
              {selectedList.length > 0 && (
                <Button size="small" variant="text" color="inherit" onClick={handleClearSelection}>
                  清空已选 ({selectedList.length})
                </Button>
              )}
            </Stack>
          </Stack>
        )}

        {/* Grouped Model Accordions */}
        {!probing && !searching && activeGroups.length === 0 && (
          <Box sx={{ py: 5, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {sourceTab === "probe"
                ? "暂无可展示的远端模型记录"
                : "暂无匹配的模型记录，请调整筛选条件或更新模型库"}
            </Typography>
          </Box>
        )}

        <Stack spacing={1}>
          {activeGroups.map((group) => {
            const addable = group.models.filter((m) => !existingIds.has(m.id));
            const selectedInGroup = addable.filter((m) => Boolean(selectedMap[m.id]));
            const allGroupChecked =
              addable.length > 0 && selectedInGroup.length === addable.length;
            const groupIndeterminate =
              selectedInGroup.length > 0 && selectedInGroup.length < addable.length;
            const prefixColor = getPrefixColor(group.prefix);
            const isExpanded = expandedPrefixes[group.prefix] ?? activeGroups.length <= 5;

            return (
              <Accordion
                key={group.prefix}
                expanded={isExpanded}
                onChange={(_, exp) =>
                  setExpandedPrefixes((prev) => ({ ...prev, [group.prefix]: exp }))
                }
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ width: "100%", pr: 1 }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Checkbox
                        size="small"
                        disabled={addable.length === 0}
                        checked={allGroupChecked}
                        indeterminate={groupIndeterminate}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleGroup(group, e.target.checked)}
                        inputProps={{ "aria-label": `整组选择 ${group.prefix}` }}
                      />
                      <Chip
                        label={group.prefix}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          backgroundColor: prefixColor.bg,
                          color: prefixColor.fg,
                          border: `1px solid ${prefixColor.border}`,
                        }}
                      />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {group.models.length} 个模型
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {selectedInGroup.length > 0 && (
                        <Chip
                          label={`已选 ${selectedInGroup.length}`}
                          size="small"
                          color="primary"
                        />
                      )}
                      {addable.length < group.models.length && (
                        <Chip
                          label={`已存在 ${group.models.length - addable.length}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <Stack divider={<Box sx={{ borderBottom: "1px solid #f1f5f9" }} />}>
                    {group.models.map((item) => {
                      const alreadyExists = existingIds.has(item.id);
                      const checked = Boolean(selectedMap[item.id]);
                      const def = item.defaults;
                      const hasDef = Boolean(def && def.found);

                      return (
                        <Stack
                          key={item.id}
                          component="label"
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                          sx={{
                            px: 2,
                            py: 0.75,
                            cursor: alreadyExists ? "default" : "pointer",
                            backgroundColor: checked
                              ? "rgba(27, 97, 201, 0.05)"
                              : alreadyExists
                                ? "#f8fafc"
                                : "#ffffff",
                            "&:hover": {
                              backgroundColor: alreadyExists
                                ? "#f8fafc"
                                : "rgba(27, 97, 201, 0.08)",
                            },
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                            <Checkbox
                              size="small"
                              disabled={alreadyExists}
                              checked={checked}
                              onChange={(e) => toggleCandidate(item, e.target.checked)}
                            />
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: MONOSPACE_FONT,
                                fontWeight: checked ? 600 : 500,
                                color: alreadyExists ? "text.disabled" : "text.primary",
                              }}
                            >
                              {item.id}
                            </Typography>
                            {item.name && item.name !== item.id && (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "text.secondary",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                ({item.name})
                              </Typography>
                            )}
                          </Stack>

                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
                            {hasDef && def && (
                              <>
                                {def.limit.context !== null && (
                                  <Chip
                                    label={`上下文: ${formatNumberCompact(def.limit.context)}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: "0.68rem" }}
                                  />
                                )}
                                {def.modalities.input.length > 0 && (
                                  <Chip
                                    label={`输入: ${def.modalities.input.join(",")}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: "0.68rem" }}
                                  />
                                )}
                                {Object.keys(def.variants).length > 0 && (
                                  <Chip
                                    label={`变体: ${Object.keys(def.variants).length}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: "0.68rem" }}
                                  />
                                )}
                              </>
                            )}
                            {alreadyExists && (
                              <Chip
                                label="已存在（跳过）"
                                size="small"
                                color="default"
                                sx={{ height: 20, fontSize: "0.68rem" }}
                              />
                            )}
                          </Stack>
                        </Stack>
                      );
                    })}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ width: "100%" }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            已勾选 <strong>{selectedList.length}</strong> 个待添加模型（确认后将自动带入默认上下文、模态与变体配置）
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="contained"
              disabled={selectedList.length === 0}
              onClick={handleConfirmAdd}
            >
              确认添加 ({selectedList.length})
            </Button>
          </Stack>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};
