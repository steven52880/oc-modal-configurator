import { createTheme } from "@mui/material/styles";

export const MONOSPACE_FONT =
  '"Berkeley Mono", "JetBrains Mono", "Cascadia Code", "IBM Plex Mono", "Consolas", monospace';

export const UI_SANS_FONT =
  '"Inter Variable", "Inter", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1b61c9",
      light: "#eef5ff",
      dark: "#0043ce",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#0288d1",
      light: "#e0f2fe",
      dark: "#01579b",
    },
    success: {
      main: "#15803d",
      light: "#dcfce7",
      dark: "#14532d",
    },
    warning: {
      main: "#b45309",
      light: "#fef3c7",
      dark: "#78350f",
    },
    error: {
      main: "#dc2626",
      light: "#fee2e2",
      dark: "#991b1b",
    },
    background: {
      default: "#f4f6f9",
      paper: "#ffffff",
    },
    text: {
      primary: "#181d26",
      secondary: "#475569",
      disabled: "#64748b",
    },
    divider: "#e2e8f0",
  },
  shape: {
    borderRadius: 6,
  },
  typography: {
    fontFamily: UI_SANS_FONT,
    fontSize: 13,
    h6: {
      fontSize: "0.95rem",
      fontWeight: 600,
      lineHeight: 1.35,
    },
    subtitle1: {
      fontSize: "0.85rem",
      fontWeight: 600,
      lineHeight: 1.4,
    },
    subtitle2: {
      fontSize: "0.8rem",
      fontWeight: 600,
      lineHeight: 1.4,
    },
    body1: {
      fontSize: "0.8125rem",
      lineHeight: 1.45,
    },
    body2: {
      fontSize: "0.78125rem",
      lineHeight: 1.4,
    },
    caption: {
      fontSize: "0.72rem",
      lineHeight: 1.35,
    },
    button: {
      fontSize: "0.78125rem",
      fontWeight: 500,
      textTransform: "none",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "*, *::before, *::after": {
          boxSizing: "border-box",
        },
        "html, body, #root": {
          height: "100%",
          margin: 0,
          padding: 0,
          overflow: "hidden",
          backgroundColor: "#f4f6f9",
          color: "#181d26",
          fontFeatureSettings: '"cv01", "ss03"',
          WebkitFontSmoothing: "antialiased",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            transitionDuration: "0.01ms !important",
          },
        },
        // Popper（Autocomplete 下拉、Tooltip）在 popper.js 首次定位前没有 data-popper-placement，
        // WebView2 下这一帧会被绘制出来，表现为下拉框先闪现在左下角；定位完成前先隐藏
        ".MuiPopper-root:not([data-popper-placement])": {
          visibility: "hidden",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        size: "small",
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          whiteSpace: "nowrap",
          flexShrink: 0,
          minHeight: 28,
          padding: "3px 10px",
          borderRadius: 5,
          fontWeight: 500,
        },
        sizeSmall: {
          fontSize: "0.78125rem",
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        root: {
          borderRadius: 5,
          padding: 4,
        },
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        root: {
          whiteSpace: "nowrap",
          borderRadius: 4,
          height: 22,
          fontSize: "0.72rem",
          fontWeight: 500,
        },
        labelSmall: {
          paddingLeft: 6,
          paddingRight: 6,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "3px 8px",
          fontSize: "0.78125rem",
          lineHeight: 1.35,
          borderBottom: "1px solid #e2e8f0",
          borderRight: "1px solid #eef2f6",
          userSelect: "none",
        },
        head: {
          backgroundColor: "#f8fafc",
          color: "#475569",
          fontWeight: 600,
          fontSize: "0.75rem",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          padding: "5px 8px",
          borderBottom: "1px solid #cbd5e1",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
        variant: "outlined",
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          fontSize: "0.84rem",
          backgroundColor: "#ffffff",
        },
        input: {
          padding: "9.5px 12px",
        },
        inputSizeSmall: {
          padding: "9.5px 12px",
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "0.84rem",
        },
        sizeSmall: {
          transform: "translate(12px, 9px) scale(1)",
          "&.MuiInputLabel-shrink": {
            transform: "translate(14px, -8px) scale(0.78)",
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          "&.MuiInputBase-inputSizeSmall": {
            paddingTop: "9.5px",
            paddingBottom: "9.5px",
            paddingLeft: "12px",
          },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        inputRoot: {
          "&.MuiOutlinedInput-root.MuiInputBase-sizeSmall": {
            paddingTop: "5px",
            paddingBottom: "5px",
            paddingLeft: "8px",
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          marginTop: 4,
          marginLeft: 2,
          fontSize: "0.72rem",
          lineHeight: 1.4,
        },
      },
    },
    MuiCheckbox: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        root: {
          padding: 3,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          border: "1px solid #cbd5e1",
          boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14)",
          backgroundImage: "none",
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          padding: "12px 20px",
          fontSize: "0.95rem",
          fontWeight: 600,
          backgroundColor: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: "18px 20px",
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: "12px 20px",
          backgroundColor: "#f8fafc",
          borderTop: "1px solid #e2e8f0",
        },
      },
    },
    MuiAccordion: {
      defaultProps: {
        disableGutters: true,
        elevation: 0,
      },
      styleOverrides: {
        root: {
          border: "1px solid #e2e8f0",
          borderRadius: "6px !important",
          "&:before": {
            display: "none",
          },
          "& + &": {
            marginTop: 10,
          },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 40,
          padding: "0 14px",
          backgroundColor: "#f8fafc",
          borderRadius: 6,
          "&.Mui-expanded": {
            minHeight: 40,
            borderBottom: "1px solid #e2e8f0",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          },
        },
        content: {
          margin: "8px 0",
          alignItems: "center",
          gap: 8,
        },
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: {
          padding: "14px 16px",
          backgroundColor: "#ffffff",
          borderBottomLeftRadius: 6,
          borderBottomRightRadius: 6,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 40,
          padding: "6px 14px",
          fontSize: "0.8125rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 40,
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        arrow: true,
        disableInteractive: true,
      },
      styleOverrides: {
        tooltip: {
          fontSize: "0.75rem",
          backgroundColor: "#1e293b",
          maxWidth: 480,
          wordBreak: "break-all",
        },
      },
    },
  },
});
