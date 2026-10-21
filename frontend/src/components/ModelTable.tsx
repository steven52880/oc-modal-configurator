import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import ContentPasteGoIcon from "@mui/icons-material/ContentPasteGo";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import TuneIcon from "@mui/icons-material/Tune";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import {
  MODALITIES,
  MODEL_COLUMN_IDS,
  VARIANT_ORDER,
  type ModelEntry,
  type ProviderEntry,
} from "../types/domain";
import { useSpreadsheetSelection } from "../hooks/useSpreadsheetSelection";
import {
  MODALITY_META,
  VARIANT_META,
  formatNumberCompact,
  getModelPrefix,
  getPrefixColor,
  serializeModalities,
  serializeVariants,
  sortModelsForDisplay,
  type KnownModality,
} from "../utils/modelHelpers";
import { MONOSPACE_FONT } from "../theme";

export type ModelColumnId = (typeof MODEL_COLUMN_IDS)[number];

const DEFAULT_MODEL_WIDTHS: Record<ModelColumnId, number> = {
  key: 240,
  context: 110,
  output: 110,
  inputModalities: 136,
  outputModalities: 136,
  variants: 336,
};

const MODALITY_ICONS: Record<KnownModality, React.ElementType> = {
  text: TextFieldsIcon,
  image: ImageOutlinedIcon,
  audio: GraphicEqIcon,
  video: VideocamOutlinedIcon,
  pdf: PictureAsPdfOutlinedIcon,
};

const COLUMN_LABELS: Record<ModelColumnId, string> = {
  key: "模型标识符",
  context: "上下文长度",
  output: "输出长度",
  inputModalities: "输入模态",
  outputModalities: "输出模态",
  variants: "变体 (Variants)",
};

interface ModelTableProps {
  provider: ProviderEntry | null;
  checkedKeys: string[];
  columnWidths: Record<string, number>;
  applyingDefaults?: boolean;
  onChangeCheckedKeys: (keys: string[]) => void;
  onUpdateModelCell: (
    modelKey: string,
    columnId: ModelColumnId,
    value: string,
  ) => { ok: boolean; error?: string };
  onToggleModelModality: (
    modelKey: string,
    direction: "input" | "output",
    modality: string,
    checked: boolean,
  ) => void;
  onToggleModelVariant: (modelKey: string, variantKey: string, checked: boolean) => void;
  onApplySelectionDefaults: (rowIds: string[], columnIds: string[]) => void;
  onAddBlankModel: () => void;
  onOpenAddModelsDialog: () => void;
  onOpenSingleEdit: (modelKey: string) => void;
  onOpenBatchEdit: () => void;
  onDeleteModels: (keys: string[]) => void;
  onColumnWidthsCommit: (widths: Record<string, number>) => void;
  onStatusMessage: (message: string, severity?: "info" | "warning" | "error" | "success") => void;
}

export const ModelTable: React.FC<ModelTableProps> = ({
  provider,
  checkedKeys,
  columnWidths,
  applyingDefaults = false,
  onChangeCheckedKeys,
  onUpdateModelCell,
  onToggleModelModality,
  onToggleModelVariant,
  onApplySelectionDefaults,
  onAddBlankModel,
  onOpenAddModelsDialog,
  onOpenSingleEdit,
  onOpenBatchEdit,
  onDeleteModels,
  onColumnWidthsCommit,
  onStatusMessage,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: "key" | "context" | "output";
  } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const [localWidths, setLocalWidths] = useState<Record<string, number>>(() => ({
    ...DEFAULT_MODEL_WIDTHS,
    ...columnWidths,
  }));

  useEffect(() => {
    setLocalWidths((prev) => ({
      ...DEFAULT_MODEL_WIDTHS,
      ...prev,
      ...columnWidths,
    }));
  }, [columnWidths]);

  const displayModels = useMemo(
    () => (provider ? sortModelsForDisplay(provider.models) : []),
    [provider],
  );

  const rowIds = useMemo(() => displayModels.map((m) => m.key), [displayModels]);
  const columnIds = useMemo(() => [...MODEL_COLUMN_IDS], []);

  const modelMap = useMemo(() => {
    const map = new Map<string, ModelEntry>();
    for (const m of displayModels) {
      map.set(m.key, m);
    }
    return map;
  }, [displayModels]);

  const getValue = useCallback(
    (rowId: string, colId: string): string => {
      const m = modelMap.get(rowId);
      if (!m) return "";
      switch (colId as ModelColumnId) {
        case "key":
          return m.key;
        case "context":
          return m.limit.context !== null && m.limit.context !== undefined
            ? String(m.limit.context)
            : "";
        case "output":
          return m.limit.output !== null && m.limit.output !== undefined
            ? String(m.limit.output)
            : "";
        case "inputModalities":
          return serializeModalities(m.modalities?.input);
        case "outputModalities":
          return serializeModalities(m.modalities?.output);
        case "variants":
          return serializeVariants(m.variants);
        default:
          return "";
      }
    },
    [modelMap],
  );

  const setValue = useCallback(
    (rowId: string, colId: string, value: string) => {
      const res = onUpdateModelCell(rowId, colId as ModelColumnId, value);
      if (!res.ok && res.error) {
        onStatusMessage(res.error, "warning");
      }
    },
    [onUpdateModelCell, onStatusMessage],
  );

  const handleIdleEscape = useCallback(() => {
    if (checkedKeys.length > 0) {
      onChangeCheckedKeys([]);
    }
  }, [checkedKeys.length, onChangeCheckedKeys]);

  const selection = useSpreadsheetSelection({
    containerRef,
    rowIds,
    columnIds,
    getValue,
    setValue,
    onIdleEscape: handleIdleEscape,
  });

  useEffect(() => {
    if (selection.notice === "copy-needs-single-row") {
      onStatusMessage("仅支持复制单行连续单元格，请在同一行内框选后按 Ctrl+C", "warning");
      selection.setNotice(null);
    }
  }, [selection.notice, selection.setNotice, onStatusMessage]);

  const checkedKeysRef = useRef(checkedKeys);
  checkedKeysRef.current = checkedKeys;
  const onChangeCheckedKeysRef = useRef(onChangeCheckedKeys);
  onChangeCheckedKeysRef.current = onChangeCheckedKeys;

  useEffect(() => {
    const rectRowIds = selection.rect?.rowIds;
    if (!rectRowIds || rectRowIds.length === 0) return;
    const current = checkedKeysRef.current;
    const missing = rectRowIds.filter((id) => !current.includes(id));
    if (missing.length > 0) {
      onChangeCheckedKeysRef.current(Array.from(new Set([...current, ...missing])));
    }
  }, [selection.rect]);

  const startInlineEdit = (rowId: string, columnId: "key" | "context" | "output") => {
    setEditingCell({ rowId, columnId });
    setEditingValue(getValue(rowId, columnId));
  };

  const commitInlineEdit = () => {
    if (!editingCell) return;
    const { rowId, columnId } = editingCell;
    const val = editingValue;
    setEditingCell(null);
    const res = onUpdateModelCell(rowId, columnId, val);
    if (!res.ok && res.error) {
      onStatusMessage(res.error, "error");
    }
  };

  const cancelInlineEdit = () => {
    setEditingCell(null);
  };

  const allChecked =
    displayModels.length > 0 && checkedKeys.length === displayModels.length;
  const indeterminateChecked =
    checkedKeys.length > 0 && checkedKeys.length < displayModels.length;

  const handleToggleAll = (checked: boolean) => {
    onChangeCheckedKeys(checked ? displayModels.map((m) => m.key) : []);
  };

  const handleToggleRow = (key: string, checked: boolean) => {
    if (checked) {
      onChangeCheckedKeys(Array.from(new Set([...checkedKeys, key])));
    } else {
      onChangeCheckedKeys(checkedKeys.filter((item) => item !== key));
    }
  };

  const startResizeColumn = (colId: ModelColumnId, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = localWidths[colId] ?? DEFAULT_MODEL_WIDTHS[colId];
    let latestWidths = localWidths;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(85, Math.round(startWidth + delta));
      latestWidths = { ...latestWidths, [colId]: nextWidth };
      setLocalWidths(latestWidths);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      onColumnWidthsCommit(latestWidths);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const hasCellSelection = Boolean(selection.rect && selection.cells.length > 0);

  return (
    <Box
      ref={containerRef}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "background.paper",
        overflow: "hidden",
      }}
    >
      {/* Model Toolbar */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{
          px: 1.5,
          py: 0.75,
          backgroundColor: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          minHeight: 38,
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" sx={{ color: "text.primary", whiteSpace: "nowrap" }}>
            模型列表
          </Typography>
          {provider ? (
            <Chip
              label={`共 ${displayModels.length} 个模型`}
              size="small"
              sx={{ backgroundColor: "#e2e8f0", color: "#334155" }}
            />
          ) : (
            <Chip label="未选择提供商" size="small" color="default" />
          )}
          {selection.lock && (
            <Tooltip title="已锁定复制列，框选目标行后按 Ctrl+V 粘贴，按 Esc 退出">
              <Chip
                icon={<ContentPasteGoIcon sx={{ fontSize: "14px !important" }} />}
                label="复制模式"
                color="secondary"
                variant="filled"
                size="small"
              />
            </Tooltip>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Tooltip title="从提供商 /models 接口或本地 models.dev 模型库添加模型">
            <span>
              <Button
                size="small"
                variant="contained"
                disabled={!provider}
                startIcon={<CloudDownloadOutlinedIcon fontSize="small" />}
                onClick={onOpenAddModelsDialog}
              >
                添加
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="手动新建空白模型配置">
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!provider}
                startIcon={<AddIcon fontSize="small" />}
                onClick={onAddBlankModel}
              >
                新建
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="将当前框选单元格对应的字段重置为 models.dev 默认值">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                disabled={!provider || !hasCellSelection || applyingDefaults}
                startIcon={<AutoFixHighIcon fontSize="small" />}
                onClick={() => {
                  if (selection.rect) {
                    onApplySelectionDefaults(selection.rect.rowIds, selection.rect.columnIds);
                  }
                }}
              >
                {applyingDefaults ? "匹配中" : "默认"}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="批量编辑已勾选的模型">
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!provider || checkedKeys.length === 0}
                startIcon={<TuneIcon fontSize="small" />}
                onClick={onOpenBatchEdit}
              >
                {checkedKeys.length > 0 ? `编辑 (${checkedKeys.length})` : "编辑"}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="删除已勾选的模型">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={!provider || checkedKeys.length === 0}
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                onClick={() => onDeleteModels(checkedKeys)}
              >
                {checkedKeys.length > 0 ? `删除 (${checkedKeys.length})` : "删除"}
              </Button>
            </span>
          </Tooltip>
          {checkedKeys.length > 0 && (
            <Tooltip title="取消所有已勾选的模型行">
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={<ClearAllIcon fontSize="small" />}
                onClick={() => onChangeCheckedKeys([])}
              >
                清选
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* Spreadsheet Table Container */}
      <TableContainer
        onPointerDown={(e) => {
          if (
            !(
              e.target instanceof Element &&
              e.target.closest("input[type='text'], input[type='number'], textarea")
            ) &&
            document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body
          ) {
            document.activeElement.blur();
          }
        }}
        sx={{
          flex: 1,
          overflow: "auto",
          position: "relative",
        }}
      >
        <Table stickyHeader size="small" sx={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40, textAlign: "center", px: 0.5 }}>
                <Checkbox
                  disabled={!provider || displayModels.length === 0}
                  checked={allChecked}
                  indeterminate={indeterminateChecked}
                  onChange={(e) => handleToggleAll(e.target.checked)}
                  inputProps={{ "aria-label": "全选模型" }}
                />
              </TableCell>
              <TableCell sx={{ width: 64, textAlign: "center" }}>
                <Tooltip title="单击行号打开该模型的详细编辑弹窗">
                  <span>行号</span>
                </Tooltip>
              </TableCell>
              {MODEL_COLUMN_IDS.map((colId) => {
                const locked = selection.isPasteColumn(colId);
                const width = localWidths[colId] ?? DEFAULT_MODEL_WIDTHS[colId];
                const isNumeric = colId === "context" || colId === "output";
                return (
                  <TableCell
                    key={colId}
                    sx={{
                      width,
                      minWidth: 85,
                      position: "relative",
                      textAlign: isNumeric ? "right" : "left",
                      backgroundColor: locked ? "#e0f2fe !important" : undefined,
                      color: locked ? "#0369a1 !important" : undefined,
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent={isNumeric ? "flex-end" : "space-between"}
                      spacing={0.5}
                    >
                      <span>{COLUMN_LABELS[colId]}</span>
                    </Stack>
                    {/* Column Resize Handle */}
                    <Box
                      onPointerDown={(e) => startResizeColumn(colId, e)}
                      sx={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: 6,
                        cursor: "col-resize",
                        zIndex: 2,
                        "&:hover": {
                          backgroundColor: "primary.main",
                          opacity: 0.35,
                        },
                      }}
                    />
                  </TableCell>
                );
              })}
              <TableCell sx={{ width: 76, textAlign: "center" }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!provider ? (
              <TableRow>
                <TableCell colSpan={9} sx={{ py: 6, textAlign: "center" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    请先在上方提供商表格中选择或新建一个提供商
                  </Typography>
                </TableCell>
              </TableRow>
            ) : displayModels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} sx={{ py: 5, textAlign: "center" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
                    提供商 <strong>{provider.name || provider.key}</strong> 下暂无模型配置
                  </Typography>
                  <Stack direction="row" spacing={1} justifyContent="center">
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<CloudDownloadOutlinedIcon />}
                      onClick={onOpenAddModelsDialog}
                    >
                      从接口或模型库添加模型
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={onAddBlankModel}
                    >
                      手动新建空模型
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : (
              displayModels.map((model, index) => {
                const isChecked = checkedKeys.includes(model.key);
                const prefix = getModelPrefix(model.key);
                const prefixColor = getPrefixColor(prefix);

                return (
                  <TableRow
                    key={model.key}
                    hover
                    sx={{
                      backgroundColor: isChecked ? "rgba(27, 97, 201, 0.04)" : undefined,
                    }}
                  >
                    {/* Leading Checkbox */}
                    <TableCell sx={{ textAlign: "center", px: 0.5 }}>
                      <Checkbox
                        checked={isChecked}
                        onChange={(e) => handleToggleRow(model.key, e.target.checked)}
                        inputProps={{ "aria-label": `选择模型 ${model.key}` }}
                      />
                    </TableCell>

                    {/* Row Header (Single-click opens detail dialog) */}
                    <TableCell
                      onClick={() => onOpenSingleEdit(model.key)}
                      sx={{
                        textAlign: "center",
                        cursor: "pointer",
                        backgroundColor: "#f8fafc",
                        color: "text.secondary",
                        fontWeight: 500,
                      }}
                    >
                      <Tooltip title="单击行号打开模型详情编辑弹窗">
                        <Box component="span" sx={{ display: "inline-block", width: "100%" }}>
                          {index + 1}
                        </Box>
                      </Tooltip>
                    </TableCell>

                    {/* Column: key */}
                    {(() => {
                      const colId: ModelColumnId = "key";
                      const cellSelected = selection.isSelected(model.key, colId);
                      const pasteCol = selection.isPasteColumn(colId);
                      const isEditing =
                        editingCell?.rowId === model.key && editingCell?.columnId === "key";

                      return (
                        <TableCell
                          data-sheet-cell="true"
                          data-row-id={model.key}
                          data-col-id={colId}
                          onDoubleClick={() => startInlineEdit(model.key, "key")}
                          sx={{
                            cursor: "cell",
                            fontFamily: MONOSPACE_FONT,
                            backgroundColor: cellSelected
                              ? "rgba(27, 97, 201, 0.14)"
                              : pasteCol
                                ? "rgba(2, 136, 209, 0.05)"
                                : undefined,
                            outline: cellSelected ? "1.5px solid #1b61c9" : undefined,
                            outlineOffset: -1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isEditing ? (
                            <TextField
                              autoFocus
                              fullWidth
                              size="small"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitInlineEdit();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelInlineEdit();
                                }
                              }}
                              sx={{
                                "& .MuiInputBase-input": {
                                  py: "2px",
                                  px: "6px",
                                  fontSize: "0.78125rem",
                                  fontFamily: MONOSPACE_FONT,
                                },
                              }}
                            />
                          ) : (
                            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ overflow: "hidden" }}>
                              <Chip
                                label={prefix}
                                size="small"
                                sx={{
                                  height: 18,
                                  fontSize: "0.68rem",
                                  fontWeight: 600,
                                  backgroundColor: prefixColor.bg,
                                  color: prefixColor.fg,
                                  border: `1px solid ${prefixColor.border}`,
                                  flexShrink: 0,
                                }}
                              />
                              <Tooltip
                                title={
                                  model.name && model.name !== model.key
                                    ? `${model.key} (${model.name})`
                                    : model.key
                                }
                              >
                                <Box
                                  component="span"
                                  sx={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {model.key}
                                </Box>
                              </Tooltip>
                            </Stack>
                          )}
                        </TableCell>
                      );
                    })()}

                    {/* Columns: context & output */}
                    {(["context", "output"] as const).map((colId) => {
                      const cellSelected = selection.isSelected(model.key, colId);
                      const pasteCol = selection.isPasteColumn(colId);
                      const isEditing =
                        editingCell?.rowId === model.key && editingCell?.columnId === colId;
                      const numValue = model.limit[colId];

                      return (
                        <TableCell
                          key={colId}
                          data-sheet-cell="true"
                          data-row-id={model.key}
                          data-col-id={colId}
                          onDoubleClick={() => startInlineEdit(model.key, colId)}
                          sx={{
                            cursor: "cell",
                            textAlign: "right",
                            fontFamily: MONOSPACE_FONT,
                            fontVariantNumeric: "tabular-nums",
                            backgroundColor: cellSelected
                              ? "rgba(27, 97, 201, 0.14)"
                              : pasteCol
                                ? "rgba(2, 136, 209, 0.05)"
                                : undefined,
                            outline: cellSelected ? "1.5px solid #1b61c9" : undefined,
                            outlineOffset: -1,
                          }}
                        >
                          {isEditing ? (
                            <TextField
                              autoFocus
                              fullWidth
                              size="small"
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitInlineEdit();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelInlineEdit();
                                }
                              }}
                              sx={{
                                "& .MuiInputBase-input": {
                                  py: "2px",
                                  px: "6px",
                                  textAlign: "right",
                                  fontSize: "0.78125rem",
                                  fontFamily: MONOSPACE_FONT,
                                },
                              }}
                            />
                          ) : (
                            <Box
                              component="span"
                              sx={{
                                color:
                                  numValue !== null && numValue !== undefined
                                    ? "text.primary"
                                    : "text.disabled",
                              }}
                            >
                              {formatNumberCompact(numValue)}
                            </Box>
                          )}
                        </TableCell>
                      );
                    })}

                    {/* Columns: inputModalities & outputModalities */}
                    {(
                      [
                        { colId: "inputModalities" as const, dir: "input" as const },
                        { colId: "outputModalities" as const, dir: "output" as const },
                      ] as const
                    ).map(({ colId, dir }) => {
                      const cellSelected = selection.isSelected(model.key, colId);
                      const pasteCol = selection.isPasteColumn(colId);
                      const currentList = model.modalities?.[dir] ?? [];
                      const unknownList = currentList.filter(
                        (item) => !MODALITIES.includes(item as (typeof MODALITIES)[number]),
                      );

                      return (
                        <TableCell
                          key={colId}
                          data-sheet-cell="true"
                          data-row-id={model.key}
                          data-col-id={colId}
                          sx={{
                            cursor: "cell",
                            backgroundColor: cellSelected
                              ? "rgba(27, 97, 201, 0.14)"
                              : pasteCol
                                ? "rgba(2, 136, 209, 0.05)"
                                : undefined,
                            outline: cellSelected ? "1.5px solid #1b61c9" : undefined,
                            outlineOffset: -1,
                            whiteSpace: "nowrap",
                            px: 0.75,
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexWrap: "nowrap" }}>
                            {MODALITIES.map((mod) => {
                              const checked = currentList.includes(mod);
                              const meta = MODALITY_META[mod];
                              const IconComp = MODALITY_ICONS[mod];
                              return (
                                <Tooltip
                                  key={mod}
                                  title={`${meta.label} (${meta.zhName})`}
                                  arrow
                                  disableInteractive
                                >
                                  <Box
                                    component="label"
                                    aria-label={`${dir === "input" ? "输入" : "输出"}模态 ${meta.label}`}
                                    sx={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: 22,
                                      height: 22,
                                      borderRadius: 1,
                                      cursor: "pointer",
                                      color: checked ? meta.activeColor : "#94A3B8",
                                      backgroundColor: checked ? meta.activeBg : "transparent",
                                      border: checked
                                        ? `1px solid ${meta.activeBorder}`
                                        : "1px solid transparent",
                                      transition: "color 120ms ease, background-color 120ms ease",
                                      "&:hover": {
                                        backgroundColor: checked
                                          ? meta.activeBg
                                          : "rgba(148, 163, 184, 0.14)",
                                      },
                                    }}
                                  >
                                    <Checkbox
                                      size="small"
                                      checked={checked}
                                      onChange={(e) =>
                                        onToggleModelModality(model.key, dir, mod, e.target.checked)
                                      }
                                      icon={<IconComp sx={{ fontSize: 15, color: "#94A3B8" }} />}
                                      checkedIcon={
                                        <IconComp sx={{ fontSize: 15, color: meta.activeColor }} />
                                      }
                                      sx={{ p: 0 }}
                                    />
                                  </Box>
                                </Tooltip>
                              );
                            })}
                            {unknownList.length > 0 && (
                              <Tooltip title={`保留的扩展模态: ${unknownList.join(", ")}`}>
                                <Chip
                                  label={`+${unknownList.length}`}
                                  size="small"
                                  sx={{ height: 16, fontSize: "0.65rem", ml: 0.25 }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      );
                    })}

                    {/* Column: variants */}
                    {(() => {
                      const colId: ModelColumnId = "variants";
                      const cellSelected = selection.isSelected(model.key, colId);
                      const pasteCol = selection.isPasteColumn(colId);
                      const variantKeys = Object.keys(model.variants ?? {});
                      const customKeys = variantKeys.filter(
                        (k) => !VARIANT_ORDER.includes(k as (typeof VARIANT_ORDER)[number]),
                      );

                      return (
                        <TableCell
                          data-sheet-cell="true"
                          data-row-id={model.key}
                          data-col-id={colId}
                          sx={{
                            cursor: "cell",
                            backgroundColor: cellSelected
                              ? "rgba(27, 97, 201, 0.14)"
                              : pasteCol
                                ? "rgba(2, 136, 209, 0.05)"
                                : undefined,
                            outline: cellSelected ? "1.5px solid #1b61c9" : undefined,
                            outlineOffset: -1,
                            whiteSpace: "nowrap",
                            px: 0.75,
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexWrap: "nowrap" }}>
                            {VARIANT_ORDER.map((variantKey) => {
                              const checked = Boolean(model.variants && variantKey in model.variants);
                              const vMeta = VARIANT_META[variantKey];
                              return (
                                <Tooltip
                                  key={variantKey}
                                  title={vMeta.tooltip}
                                  arrow
                                  disableInteractive
                                >
                                  <Box
                                    component="label"
                                    aria-label={`变体 ${variantKey}`}
                                    sx={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      cursor: "pointer",
                                      fontSize: "0.70rem",
                                      fontFamily: MONOSPACE_FONT,
                                      color: checked ? "primary.dark" : "text.secondary",
                                      fontWeight: checked ? 700 : 400,
                                      px: 0.25,
                                      borderRadius: 0.75,
                                      backgroundColor: checked
                                        ? "rgba(27, 97, 201, 0.08)"
                                        : "transparent",
                                    }}
                                  >
                                    <Checkbox
                                      size="small"
                                      checked={checked}
                                      onChange={(e) =>
                                        onToggleModelVariant(model.key, variantKey, e.target.checked)
                                      }
                                      sx={{
                                        p: "1px",
                                        "& .MuiSvgIcon-root": { fontSize: 14 },
                                      }}
                                    />
                                    <span>{vMeta.shortLabel}</span>
                                  </Box>
                                </Tooltip>
                              );
                            })}
                            {customKeys.length > 0 && (
                              <Tooltip title={`自定义变体: ${customKeys.join(", ")}`}>
                                <Chip
                                  label={`+${customKeys.length}`}
                                  size="small"
                                  sx={{ height: 16, fontSize: "0.65rem" }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      );
                    })()}

                    {/* Trailing Action Cell */}
                    <TableCell sx={{ textAlign: "center", px: 0.5 }}>
                      <Stack direction="row" spacing={0.25} justifyContent="center">
                        <Tooltip title="详细编辑模型">
                          <IconButton
                            size="small"
                            aria-label={`详细编辑模型 ${model.key}`}
                            onClick={() => onOpenSingleEdit(model.key)}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除模型">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={`删除模型 ${model.key}`}
                            onClick={() => onDeleteModels([model.key])}
                          >
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
