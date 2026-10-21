import React from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { HeaderMap } from "../types/domain";
import { MONOSPACE_FONT } from "../theme";

export interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

export function headerMapToRows(headers: HeaderMap | null | undefined): HeaderRow[] {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value], index) => ({
    id: `hdr-${index}-${name}`,
    name,
    value: value === null || value === undefined ? "" : String(value),
  }));
}

export function rowsToHeaderMap(rows: HeaderRow[]): HeaderMap {
  const result: HeaderMap = {};
  for (const row of rows) {
    const trimmedName = row.name.trim();
    if (trimmedName) {
      result[trimmedName] = row.value;
    }
  }
  return result;
}

interface KeyValueHeaderEditorProps {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  isMixed?: boolean;
  onClearMixed?: () => void;
  label?: string;
}

export const KeyValueHeaderEditor: React.FC<KeyValueHeaderEditorProps> = ({
  rows,
  onChange,
  isMixed = false,
  onClearMixed,
  label = "自定义请求头 (Headers)",
}) => {
  const handleAddRow = () => {
    if (isMixed && onClearMixed) {
      onClearMixed();
    }
    onChange([
      ...rows,
      {
        id: `hdr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        value: "",
      },
    ]);
  };

  const handleRowChange = (id: string, field: "name" | "value", text: string) => {
    if (isMixed && onClearMixed) {
      onClearMixed();
    }
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: text } : row)));
  };

  const handleDeleteRow = (id: string) => {
    if (isMixed && onClearMixed) {
      onClearMixed();
    }
    onChange(rows.filter((row) => row.id !== id));
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
          {label}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon fontSize="small" />}
          onClick={handleAddRow}
        >
          添加请求头
        </Button>
      </Stack>

      {isMixed ? (
        <Alert
          severity="info"
          sx={{ py: 0.5, mb: 1 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                onClearMixed?.();
                onChange([]);
              }}
            >
              清空并统一覆盖
            </Button>
          }
        >
          当前所选多行的请求头不一致（状态为 <code>&lt;...&gt;</code>
          ）。不修改将保留各行原有请求头。
        </Alert>
      ) : rows.length === 0 ? (
        <Typography variant="caption" sx={{ color: "text.disabled", display: "block", py: 0.5 }}>
          尚未配置自定义请求头。点击右上角「添加请求头」新增键值对。
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Stack key={row.id} direction="row" spacing={1.5} alignItems="center">
              <TextField
                label="Header 名称"
                placeholder="X-Custom-Header"
                value={row.name}
                onChange={(e) => handleRowChange(row.id, "name", e.target.value)}
                sx={{
                  flex: 1,
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
              />
              <TextField
                label="Header 值"
                placeholder="Bearer {env:CUSTOM_TOKEN}"
                value={row.value}
                onChange={(e) => handleRowChange(row.id, "value", e.target.value)}
                sx={{
                  flex: 1.4,
                  "& .MuiInputBase-input": { fontFamily: MONOSPACE_FONT },
                }}
              />
              <Tooltip title="删除此请求头">
                <IconButton
                  color="error"
                  aria-label="删除此请求头"
                  onClick={() => handleDeleteRow(row.id)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
};
