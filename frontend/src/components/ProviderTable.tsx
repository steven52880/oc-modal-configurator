import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
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
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ContentPasteGoIcon from "@mui/icons-material/ContentPasteGo";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import TuneIcon from "@mui/icons-material/Tune";
import {
  NPM_PRESETS,
  PROVIDER_COLUMN_IDS,
  type ProviderEntry,
} from "../types/domain";
import { useSpreadsheetSelection } from "../hooks/useSpreadsheetSelection";
import { MONOSPACE_FONT } from "../theme";

type ProviderColumnId = (typeof PROVIDER_COLUMN_IDS)[number];

const DEFAULT_PROVIDER_WIDTHS: Record<ProviderColumnId, number> = {
  name: 190,
  key: 170,
  npm: 230,
  baseURL: 360,
};

const COLUMN_LABELS: Record<ProviderColumnId, string> = {
  name: "提供商名称",
  key: "提供商标识符",
  npm: "提供商类型 (npm)",
  baseURL: "提供商 URL",
};

interface ProviderTableProps {
  providers: ProviderEntry[];
  selectedProviderKey: string | null;
  checkedKeys: string[];
  columnWidths: Record<string, number>;
  onSelectProvider: (key: string) => void;
  onChangeCheckedKeys: (keys: string[]) => void;
  onUpdateProviderCell: (
    providerKey: string,
    columnId: ProviderColumnId,
    value: string,
  ) => { ok: boolean; error?: string };
  onAddProvider: () => void;
  onOpenSingleEdit: (providerKey: string) => void;
  onOpenBatchEdit: () => void;
  onDeleteProviders: (keys: string[]) => void;
  onColumnWidthsCommit: (widths: Record<string, number>) => void;
  onStatusMessage: (message: string, severity?: "info" | "warning" | "error" | "success") => void;
}

export const ProviderTable: React.FC<ProviderTableProps> = ({
  providers,
  selectedProviderKey,
  checkedKeys,
  columnWidths,
  onSelectProvider,
  onChangeCheckedKeys,
  onUpdateProviderCell,
  onAddProvider,
  onOpenSingleEdit,
  onOpenBatchEdit,
  onDeleteProviders,
  onColumnWidthsCommit,
  onStatusMessage,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: ProviderColumnId;
  } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const [localWidths, setLocalWidths] = useState<Record<string, number>>(() => ({
    ...DEFAULT_PROVIDER_WIDTHS,
    ...columnWidths,
  }));

  useEffect(() => {
    setLocalWidths((prev) => ({
      ...DEFAULT_PROVIDER_WIDTHS,
      ...prev,
      ...columnWidths,
    }));
  }, [columnWidths]);

  const rowIds = useMemo(() => providers.map((p) => p.key), [providers]);
  const columnIds = useMemo(() => [...PROVIDER_COLUMN_IDS], []);

  const providerMap = useMemo(() => {
    const map = new Map<string, ProviderEntry>();
    for (const p of providers) {
      map.set(p.key, p);
    }
    return map;
  }, [providers]);

  const getValue = useCallback(
    (rowId: string, colId: string): string => {
      const p = providerMap.get(rowId);
      if (!p) return "";
      switch (colId as ProviderColumnId) {
        case "name":
          return p.name ?? "";
        case "key":
          return p.key;
        case "npm":
          return p.npm ?? "";
        case "baseURL":
          return p.options.baseURL ?? "";
        default:
          return "";
      }
    },
    [providerMap],
  );

  const setValue = useCallback(
    (rowId: string, colId: string, value: string) => {
      const res = onUpdateProviderCell(rowId, colId as ProviderColumnId, value);
      if (!res.ok && res.error) {
        onStatusMessage(res.error, "warning");
      }
    },
    [onUpdateProviderCell, onStatusMessage],
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

  const startInlineEdit = (rowId: string, columnId: ProviderColumnId) => {
    setEditingCell({ rowId, columnId });
    setEditingValue(getValue(rowId, columnId));
  };

  const commitInlineEdit = (overrideValue?: string) => {
    if (!editingCell) return;
    const finalValue = overrideValue !== undefined ? overrideValue : editingValue;
    const { rowId, columnId } = editingCell;
    setEditingCell(null);
    const res = onUpdateProviderCell(rowId, columnId, finalValue);
    if (!res.ok && res.error) {
      onStatusMessage(res.error, "error");
    }
  };

  const cancelInlineEdit = () => {
    setEditingCell(null);
  };

  const allChecked = providers.length > 0 && checkedKeys.length === providers.length;
  const indeterminateChecked =
    checkedKeys.length > 0 && checkedKeys.length < providers.length;

  const handleToggleAll = (checked: boolean) => {
    onChangeCheckedKeys(checked ? providers.map((p) => p.key) : []);
  };

  const handleToggleRow = (key: string, checked: boolean) => {
    if (checked) {
      onChangeCheckedKeys(Array.from(new Set([...checkedKeys, key])));
    } else {
      onChangeCheckedKeys(checkedKeys.filter((item) => item !== key));
    }
  };

  const startResizeColumn = (colId: ProviderColumnId, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = localWidths[colId] ?? DEFAULT_PROVIDER_WIDTHS[colId];
    let latestWidths = localWidths;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(80, Math.round(startWidth + delta));
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

  return (
    <Box
      ref={containerRef}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "background.paper",
        borderBottom: "1px solid #cbd5e1",
        overflow: "hidden",
      }}
    >
      {/* Toolbar */}
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
            提供商列表
          </Typography>
          <Chip
            label={`共 ${providers.length} 个`}
            size="small"
            sx={{ backgroundColor: "#e2e8f0", color: "#334155" }}
          />
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
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon fontSize="small" />}
            onClick={onAddProvider}
          >
            新增
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={checkedKeys.length === 0}
            startIcon={<TuneIcon fontSize="small" />}
            onClick={onOpenBatchEdit}
          >
            {checkedKeys.length > 0 ? `编辑 (${checkedKeys.length})` : "编辑"}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={checkedKeys.length === 0}
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => onDeleteProviders(checkedKeys)}
          >
            {checkedKeys.length > 0 ? `删除 (${checkedKeys.length})` : "删除"}
          </Button>
          {checkedKeys.length > 0 && (
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<ClearAllIcon fontSize="small" />}
              onClick={() => onChangeCheckedKeys([])}
            >
              清选
            </Button>
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
                  checked={allChecked}
                  indeterminate={indeterminateChecked}
                  onChange={(e) => handleToggleAll(e.target.checked)}
                  inputProps={{ "aria-label": "全选提供商" }}
                />
              </TableCell>
              <TableCell sx={{ width: 64, textAlign: "center" }}>
                <Tooltip title="单击行号打开该提供商的详细编辑弹窗">
                  <span>行号</span>
                </Tooltip>
              </TableCell>
              {PROVIDER_COLUMN_IDS.map((colId) => {
                const locked = selection.isPasteColumn(colId);
                const width = localWidths[colId] ?? DEFAULT_PROVIDER_WIDTHS[colId];
                return (
                  <TableCell
                    key={colId}
                    sx={{
                      width,
                      minWidth: 80,
                      position: "relative",
                      backgroundColor: locked ? "#e0f2fe !important" : undefined,
                      color: locked ? "#0369a1 !important" : undefined,
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5}>
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
            {providers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ py: 4, textAlign: "center" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                    当前配置文件中暂无提供商记录
                  </Typography>
                  <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={onAddProvider}>
                    新增第一个提供商
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              providers.map((provider, index) => {
                const isActive = provider.key === selectedProviderKey;
                const isChecked = checkedKeys.includes(provider.key);

                return (
                  <TableRow
                    key={provider.key}
                    hover
                    onClick={() => onSelectProvider(provider.key)}
                    sx={{
                      backgroundColor: isActive
                        ? "rgba(27, 97, 201, 0.06)"
                        : isChecked
                          ? "rgba(27, 97, 201, 0.03)"
                          : undefined,
                    }}
                  >
                    {/* Leading Checkbox */}
                    <TableCell
                      sx={{ textAlign: "center", px: 0.5 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isChecked}
                        onChange={(e) => handleToggleRow(provider.key, e.target.checked)}
                        inputProps={{ "aria-label": `选择提供商 ${provider.key}` }}
                      />
                    </TableCell>

                    {/* Row Header (Single-click opens detail dialog) */}
                    <TableCell
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProvider(provider.key);
                        onOpenSingleEdit(provider.key);
                      }}
                      sx={{
                        textAlign: "center",
                        cursor: "pointer",
                        backgroundColor: isActive ? "#dbeafe" : "#f8fafc",
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? "primary.dark" : "text.secondary",
                        borderLeft: isActive ? "3px solid #1b61c9" : "3px solid transparent",
                      }}
                    >
                      <Tooltip title="单击行号打开提供商详细编辑弹窗">
                        <Box component="span" sx={{ display: "inline-block", width: "100%" }}>
                          {index + 1}
                        </Box>
                      </Tooltip>
                    </TableCell>

                    {/* Data Columns */}
                    {PROVIDER_COLUMN_IDS.map((colId) => {
                      const cellSelected = selection.isSelected(provider.key, colId);
                      const pasteCol = selection.isPasteColumn(colId);
                      const isEditing =
                        editingCell?.rowId === provider.key && editingCell?.columnId === colId;
                      const rawValue = getValue(provider.key, colId);
                      const isMono = colId === "key" || colId === "npm" || colId === "baseURL";

                      return (
                        <TableCell
                          key={colId}
                          data-sheet-cell="true"
                          data-row-id={provider.key}
                          data-col-id={colId}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startInlineEdit(provider.key, colId);
                          }}
                          sx={{
                            position: "relative",
                            cursor: "cell",
                            fontFamily: isMono ? MONOSPACE_FONT : undefined,
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
                            colId === "npm" ? (
                              <Autocomplete
                                freeSolo
                                options={[...NPM_PRESETS]}
                                value={editingValue}
                                inputValue={editingValue}
                                onInputChange={(_, newInput) => setEditingValue(newInput)}
                                onChange={(_, newVal) => {
                                  const nextVal = typeof newVal === "string" ? newVal : "";
                                  setEditingValue(nextVal);
                                  commitInlineEdit(nextVal);
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    autoFocus
                                    fullWidth
                                    size="small"
                                    onBlur={() => commitInlineEdit()}
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
                                        py: "2px !important",
                                        px: "4px !important",
                                        fontSize: "0.78125rem",
                                        fontFamily: MONOSPACE_FONT,
                                      },
                                    }}
                                  />
                                )}
                              />
                            ) : (
                              <TextField
                                autoFocus
                                fullWidth
                                size="small"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={() => commitInlineEdit()}
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
                                    fontFamily: isMono ? MONOSPACE_FONT : undefined,
                                  },
                                }}
                              />
                            )
                          ) : colId === "baseURL" ? (
                            <Tooltip title={rawValue || "未设置提供商 URL（双击可就地编辑）"}>
                              <Box
                                component="span"
                                sx={{
                                  display: "block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  color: rawValue ? "text.primary" : "text.disabled",
                                }}
                              >
                                {rawValue || "未设置"}
                              </Box>
                            </Tooltip>
                          ) : (
                            <Box
                              component="span"
                              sx={{
                                display: "block",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: rawValue ? "text.primary" : "text.disabled",
                                fontWeight: colId === "name" && isActive ? 600 : 400,
                              }}
                            >
                              {rawValue || "-"}
                            </Box>
                          )}
                        </TableCell>
                      );
                    })}

                    {/* Trailing Action Cell */}
                    <TableCell
                      sx={{ textAlign: "center", px: 0.5 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Stack direction="row" spacing={0.25} justifyContent="center">
                        <Tooltip title="详细编辑提供商">
                          <IconButton
                            size="small"
                            aria-label={`详细编辑提供商 ${provider.key}`}
                            onClick={() => onOpenSingleEdit(provider.key)}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除提供商">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={`删除提供商 ${provider.key}`}
                            onClick={() => onDeleteProviders([provider.key])}
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
