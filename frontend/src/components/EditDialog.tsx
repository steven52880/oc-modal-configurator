import React from "react";
import {
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { ModelEntry, ProviderEntry } from "../types/domain";
import { ProviderEditSection } from "./ProviderEditSection";
import { ModelEditSection } from "./ModelEditSection";

export type EditDialogState =
  | {
      kind: "provider";
      isBatch: boolean;
      targets: ProviderEntry[];
      existingKeys: string[];
    }
  | {
      kind: "model";
      isBatch: boolean;
      providerKey: string;
      targets: ModelEntry[];
      existingKeys: string[];
    }
  | null;

interface EditDialogProps {
  state: EditDialogState;
  onClose: () => void;
  onSaveProviders: (updated: ProviderEntry[]) => void;
  onSaveModels: (updated: ModelEntry[]) => void;
}

export const EditDialog: React.FC<EditDialogProps> = ({
  state,
  onClose,
  onSaveProviders,
  onSaveModels,
}) => {
  if (!state || state.targets.length === 0) return null;

  const isProvider = state.kind === "provider";
  const isBatch = state.isBatch;

  const title = isProvider
    ? isBatch
      ? "批量编辑提供商"
      : `编辑提供商: ${state.targets[0].name || state.targets[0].key}`
    : isBatch
      ? "批量编辑模型"
      : `编辑模型: ${state.targets[0].key}`;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="edit-dialog-title"
    >
      <DialogTitle id="edit-dialog-title">
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" component="span">
              {title}
            </Typography>
            {isBatch && (
              <Chip
                label={`已选 ${state.targets.length} 项 · 未改动 <...> 将保留各行原值`}
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
          </Stack>
          <IconButton aria-label="关闭弹窗" onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {state.kind === "provider" ? (
          <ProviderEditSection
            targets={state.targets}
            existingKeys={state.existingKeys}
            isBatch={state.isBatch}
            onSave={onSaveProviders}
            onCancel={onClose}
          />
        ) : (
          <ModelEditSection
            targets={state.targets}
            providerKey={state.providerKey}
            existingKeys={state.existingKeys}
            isBatch={state.isBatch}
            onSave={onSaveModels}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
