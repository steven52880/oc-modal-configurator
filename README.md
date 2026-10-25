# OpenCode 配置编辑器 (oc-modal-configurator)

**OpenCode 配置编辑器**是一款专为 OpenCode (`opencode.json`) 打造的高密度、跨平台桌面可视化配置工具。它采用 **Python (`pywebview`) + React 18 + TypeScript + Material UI v6** 构建，直接调用操作系统原生 WebView 组件（Windows WebView2 / macOS WKWebView / Linux WebKitGTK），无需打包臃肿的浏览器内核，也不会在外部浏览器中打开标签页。

本工具针对 AI 提供商与多模型路由配置（尤其是 NewAPI 等中转/兼容服务以及官方多模态、推理模型）进行了深度优化，提供**上下分栏双表格就地编辑**、**类 Excel 二维框选与列锁定粘贴**、**带 `<...>` 混合状态的多行批量编辑**、**`models.dev` 智能默认值引擎**以及**无损字段透传保存**等核心能力。

---

## 核心特性

- **原生轻量桌面体验**：基于 `pywebview` 调用系统自带 WebView，独立窗口运行，自动记忆窗口尺寸、位置、上下分栏比例及各表格列宽。
- **四层配置展示架构**：
  - **层级 1（主界面上下双表）**：上栏管理提供商（名称、标识符、驱动包 `npm`、地址 `baseURL`），下栏管理模型（标识符、上下文限制、输出限制、输入/输出模态彩色图标开关、大写推理变体勾选）。支持双击单元格就地编辑、单击行号打开详情弹窗。
  - **层级 2（详情/批量弹窗核心区）**：默认展开高频必配项，模型字段旁配备可点击的 `默认: xxx` 胶囊，支持一键填入 `models.dev` 匹配值。
  - **层级 3（详情/批量弹窗折叠进阶区）**：超时策略、自定义请求头 (`headers`)、推理强度与交错思考 (`interleaved`)、Token 计费价格 (`cost`)、单模型驱动覆盖与扩展 JSON。非空时自动显示 `已配置 N 项` 角标。
  - **层级 4（底层无损透传）**：完整保留配置文件中的 `plugin`、`$schema`、`agent`、`mcp` 等顶层字段，以及提供商和模型对象中未在表单展示的所有扩展属性。
- **类 Excel 框选与列锁定复制粘贴**：
  - 在表内拖拽即可框选二维单元格区域，并自动勾选对应行；
  - 框选单行连续单元格按 `Ctrl+C` 进入**复制模式**（自动锁定目标列范围）；
  - 跨行框选后按 `Ctrl+V` 即可将单行多列数据批量覆盖到多行；按 `Esc` 退出复制模式。
- **多行 `<...>` 混合状态批量编辑**：勾选多行后点击「编辑」，值不一致的字段自动显示 `<...>` 占位或半选状态；未触碰的字段在保存时保持各行原值不变，修改过的字段统一覆盖。
- **可扩展模型库与离线/内网友好**：
  - 支持从提供商 `${baseURL}/models` 实时拉取模型并按前缀自动折叠分组；
  - 内置 `models.dev` 默认值引擎（预留多数据源接口），按需下载至用户缓存目录；
  - 若处于防火墙/内网环境无法在线下载模型库，界面直接提示下载链接与本地目标路径，放入文件后点击「已放好，重新读取」即可热加载。
- **CC Switch 数据源**：页面头部「配置来源」可切换为 CC Switch，直接编辑 `~/.cc-switch/cc-switch.db` 中的 OpenCode 提供商，并同步写入 `opencode.json`（CC Switch 每次启动都会以 `opencode.json` 为准）。保存前需完全退出 CC Switch；仅支持已验证的数据库版本 v19–v23，其它版本自动禁止读写；OMO 配置与 OpenCode V2 原生格式条目只读展示、不会被修改；保存前生成 `cc-switch.db.oc-modal.bak` 与 `opencode.json.bak` 备份。
- **安全保存与外部修改冲突检测**：保存前自动生成同目录 `.bak` 备份；通过纳秒级修改时间 (`mtimeNs`) 检测外部编辑器改动，发生冲突时弹窗询问重新加载或强制覆盖。

---

## 文档导航

- [需求与功能规格说明书 (`docs/requirements.md`)](docs/requirements.md)：详细的用户场景、四层字段设计、交互规则、批量编辑与异常处理规范。
- [系统架构与技术设计文档 (`docs/architecture.md`)](docs/architecture.md)：前后端分层架构、数据存储边界、Bridge RPC 契约、模型匹配算法、类 Excel 选择状态机与打包机制。
- [实现计划 (`opencode配置编辑器方案`)](.cursor/plans/opencode配置编辑器方案_d8a461f8.plan.md)：项目初始设计方案与演进记录。

---

## 目录结构

```text
oc-modal-configurator/
├── app.py                        # 桌面程序入口（支持桌面窗口模式、--dev 联调模式、--dev-server 模式）
├── requirements.txt              # Python 依赖声明 (pywebview)
├── backend/                      # Python 本地后端服务
│   ├── bridge.py                 # 暴露给 pywebview 与 HTTP 开发服务器的统一 JSON RPC Bridge
│   ├── config_service.py         # opencode.json 无损读写、校验、.bak 备份与 mtimeNs 冲突检测
│   ├── ccswitch_service.py       # CC Switch 数据库中 OpenCode 提供商的读写、版本白名单与 opencode.json 同步
│   ├── metadata_service.py       # 模型库数据源抽象 (MetadataSource)、本地缓存索引与默认值匹配引擎
│   ├── provider_probe.py         # 提供商 /models 在线拉取、解析与前缀分组
│   ├── settings_store.py         # 工具自身状态存储 (~/.config/oc-modal-configurator/settings.json)
│   ├── secrets.py                # API Key 引用解析 ({env:...} / {file:...}) 与脱敏状态描述
│   ├── fields.py                 # 字段规范化、模型前缀提取与数据类型校验辅助函数
│   ├── jsonio.py                 # 原子化 JSON 文件读写（.tmp 临时文件替换）
│   ├── paths.py                  # 路径解析与环境变量覆盖逻辑
│   ├── dev_server.py             # 本地 HTTP API 服务器（供前端开发联调）
│   └── errors.py                 # 统一业务异常定义 (ServiceError)
├── frontend/                     # React 18 + TypeScript + Vite + MUI v6 前端工程
│   ├── src/
│   │   ├── App.tsx               # 主应用外壳、顶部精简状态栏、上下可拖拽分栏与全局保存流
│   │   ├── theme.ts              # Material Design 3 紧凑型桌面主题与 CJK 字体排印配置
│   │   ├── api/bridge.ts         # 前端 Bridge 调用封装（自动适配 pywebview.api 与 /api/* HTTP 代理）
│   │   ├── types/domain.ts       # 前后端共享领域模型与常量定义
│   │   ├── selection/machine.ts  # 二维矩形框选、单行复制判定与列锁定粘贴纯函数状态机
│   │   ├── hooks/                # useSpreadsheetSelection.ts 表格鼠标拖拽与快捷键 Hook
│   │   ├── components/           # ProviderTable / ModelTable / EditDialog / AddModelsDialog 等组件
│   │   └── utils/modelHelpers.ts # 模态/变体单元格序列化、分组排序与默认值应用辅助函数
│   └── package.json
├── packaging/                    # 跨机器免安装可执行文件打包配置
│   ├── oc-modal-configurator.spec# PyInstaller 打包规格（含 WebView2 Loader 与 OpenSSL 动态库收集）
│   └── build_windows.ps1         # Windows 一键构建与压缩脚本
├── tests/                        # 后端单元测试
│   └── test_backend.py           # 覆盖无损读写、备份冲突、模型匹配、密钥解析与设置隔离的 15 项测试
└── docs/                         # 项目需求与架构设计文档
    ├── requirements.md
    └── architecture.md
```

---

## 快速开始

### 1. 直接运行已打包的可执行版本（Windows 免安装）

如果已执行过打包（或从发布包获取），无需安装 Python 或 Node.js：

1. 解压 `packaging/output/oc-modal-configurator-windows.zip`（或直接使用 `packaging/output/oc-modal-configurator/` 目录）。
2. 双击运行目录内的 `oc-modal-configurator.exe`。
   - **目标机器系统要求**：64 位 Windows 10 / 11，系统需具备 `.NET Framework 4.6.2+` 与 `Microsoft Edge WebView2 Runtime`（现代 Windows 系统均已内置；若缺失，程序启动时会弹出明确指引）。

---

### 2. 从源码启动桌面窗口

本项目将依赖安装在工作目录内的 `venv` 和 `frontend/node_modules` 中，不污染全局环境。

#### 环境准备（首次运行）

```powershell
# 1. 创建项目虚拟环境并安装 pywebview
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. 安装前端依赖并构建静态资源（若官方 npm 源受阻可使用 npmmirror）
cd frontend
npm install --registry https://registry.npmmirror.com
npm run build
cd ..
```

#### 启动正式桌面窗口

```powershell
# 默认加载并编辑 ~/.config/opencode/opencode.json
.\venv\Scripts\python.exe app.py

# 或通过 --config 指定任意配置文件路径
.\venv\Scripts\python.exe app.py --config "D:\path\to\opencode.json"
```

---

### 3. 开发与调试模式

在开发模式下，后端会自动将操作隔离到项目内的 `.dev/opencode.json` 和 `.dev/appdata/`，**绝不会修改你真实用户目录下的 `~/.config/opencode/opencode.json`**。CC Switch 数据源同样隔离：首次启动时把真实的 `~/.cc-switch/cc-switch.db` 只读复制为 `.dev/cc-switch.db`，之后只读写这份副本，并以 `.dev/opencode.json` 作为同步目标。

```powershell
# 终端 1：启动前端 Vite 开发服务器 (http://127.0.0.1:5173)
cd frontend
npm run dev

# 终端 2（方式 A）：启动本地 API 服务 + 打开指向 Vite 的原生桌面窗口
.\venv\Scripts\python.exe app.py --dev

# 终端 2（方式 B）：仅启动本地 API 服务 (http://127.0.0.1:8765)，直接在浏览器访问 http://127.0.0.1:5173 调试
.\venv\Scripts\python.exe app.py --dev-server
```

---

## 模型库更新与离线/内网手动配置

工具本身**不打包**开发用的示例 `api.json`。首次启动时本地模型库为空：

1. **在线更新**：点击顶部工具栏或「添加模型」弹窗中的 **「更新」** 按钮，程序会从 `https://models.dev/api.json` 下载最新快照并缓存。
2. **离线/防火墙后手动放置**：
   - 若网络无法连接 `models.dev`，界面会弹出提示并给出你本机的精确缓存路径：
     - 正式环境默认路径：`~/.config/oc-modal-configurator/cache/api.json`（Windows 下为 `C:\Users\<用户名>\.config\oc-modal-configurator\cache\api.json`）
   - 在可联网设备上下载 `https://models.dev/api.json`，将其保存为上述路径（若 `cache` 文件夹不存在请先新建）。
   - 回到软件点击错误提示右侧的 **「已放好，重新读取」** 按钮，即可立即加载模型库，无需重启程序。

---

## 测试与打包

### 运行后端单元测试

```powershell
.\venv\Scripts\python.exe -m unittest tests.test_backend -v
```

### 重新打包 Windows 可执行文件夹与压缩包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\build_windows.ps1
```

打包完成后，产物输出在：
- 可执行目录：`packaging/output/oc-modal-configurator/`
- 分发压缩包：`packaging/output/oc-modal-configurator-windows.zip`
