# oh-my-opencode-slim 缓存标记问题报告

- **日期**：2026-11-17，11-18 补充真实中转站数据
- **涉及版本**：oh-my-opencode-slim 3.0.7，opencode v2.2.7
- **一句话结论**  
  插件只要往请求里注入了内容，就会在对话末尾打一个<u>不带 ttl 的缓存标记</u>  
  opencode 看到已有标记就不再处理，于是配置了 `cache.ttl: "1h"` 时，占大头的对话历史仍然只缓存 5 分钟
- **当前状态**
    - 本机已打补丁，11-17 18:56 重启后台服务后生效
    - 本地抓包和经 mammotion 的真实请求都确认：补丁后对话末尾的标记带上了 1h
    - 自建 newapi 的测试证实了这个问题的实际影响：无 ttl 的那一段超过 5 分钟就要重写
    - 等用户日常使用确认没有副作用后，再向插件作者提 issue
- **相关文档**：`docs/prompt-cache-report.md`（中转站缓存测试报告）

## 问题概述

### 现象与影响范围

- **现象**  
  模型配置了 `cache.ttl: "1h"`，在 orchestrator 会话里抓包，三个缓存断点分别是
    - 最后一个工具：`ttl: 1h`
    - system：`ttl: 1h`
    - 对话末尾：<u>没有 ttl</u>，Anthropic 按默认的 5 分钟处理
- **对照**
    - build agent：三处都是 1h
    - orchestrator 加上 `disabled_hooks: ["phase-reminder"]`：三处都是 1h
- **哪些会话受影响**  
  只要请求里有下面任意一种插件注入，就会触发
    - **阶段提醒**  
      orchestrator 会话的每一轮都有，就是那段 `!IMPORTANT! Scheduler workflow...`
    - **council 提示**  
      只有配置了 council 席位、并且用户消息命中触发词时才有
    - **后台任务看板**  
      后台任务正在运行时才有；deepwork 的目标提示也算这一类
- **哪些配置不受影响**  
  模型没有设置 `cache.ttl`，或者设置成 `5m` 时，插件的标记和 opencode 的默认值一致，没有副作用
- **严重程度**
    - 工具加 system 通常只有几万 token，对话历史却有十几万到二十几万 token
    - 所以开着插件时，<u>1h 缓存只保护了小头，大头仍然 5 分钟就过期</u>
    - 在支持 1h 的中转站上，这个损失是实打实的  
      自建 newapi 的测试里，6 到 55 分钟的 18 组全部读回了 1h 段、重写了无 ttl 的那一段
    - 在 `mammotion-claude` 上看不出来：它从 11-17 起一律按 5m 写入，补不补丁都一样  
      详见 `docs/prompt-cache-report.md`

## 原因分析

### 阶段提醒的注入位置

- **代码位置**  
  `~/.cache/opencode/npm/oh-my-opencode-slim@latest/1794375103347/node_modules/oh-my-opencode-slim/dist/server/index.js`  
  原文件第 31020–31048 行，函数 `createPhaseReminderHook`
- **注入规则**
    - 只处理 agent 为 `orchestrator`、并且属于当前会话的用户消息
    - 按从旧到新的顺序，找<u>第一条</u>有正文、并且不是内部消息的用户消息
    - 在这条消息末尾追加一个 part，内容是阶段提醒
    - 这个 part 带有 `synthetic: true` 和元数据 `oh-my-opencode-slim.phaseReminder: true`
- **对缓存是安全的**
    - 提醒每轮都插在同一条早期消息里，文字也不变，所以前缀保持稳定
    - 插件源码里对应的工具函数文件就叫 `cache-safe-injection`，说明作者考虑过缓存
    - <u>提醒文字本身不是问题</u>，问题出在下一步打的标记上
- **注入只发生在请求里**  
  它是在每次请求前临时加上去的，不会写回会话记录

### 插件在对话末尾打标记

- **代码位置**  
  同一文件，原文件第 43002–43011 行，位于 `createSessionContextHandler` 里，也就是 opencode v2 的 `session.hook("context")` 桥接
- **逻辑**
    - 先检查整份请求里有没有阶段提醒、council 提示或后台任务看板这三种标签
    - 有的话，找到最后一条"不完全由看板组成"的消息
    - 如果这条消息的最后一个 part 还没有 `cache` 字段，就写上 `cache: { type: "ephemeral" }`
- **原代码**

```js
if (target && part && part.cache === undefined) {
  target.content[target.content.length - 1] = {
    ...part,
    cache: { type: "ephemeral" }   // 没有 ttl
  };
}
```

- **为什么没有 ttl**  
  插件拿到的 `context` 事件里没有缓存设置：`event.options` 只有温度、maxTokens 这类生成参数  
  要知道模型配的 ttl，得另外调 `ctx.model.list()` 去查，原代码没有这么做

### opencode 保留已有标记

- **代码位置**  
  opencode 源码 `packages/ai/src/cache-policy.ts`（提交 `2b2c6054f5`）
- **自动断点策略**
    - 默认在最后一个工具、system 的首尾、对话末尾放断点
    - ttl 来自模型配置：`packages/core/src/session/model-request.ts:337` 把 `model.cache.ttl` 放进请求
    - `makeHint` 有 ttl 就写 ttl，没有就不写（第 92–93 行）
- **已有标记的处理**
    - 已有的标记会先计入"最多 4 个断点"的额度（第 220 行）
    - 轮到对话末尾时，发现这个 part 已经有 `cache`，就原样保留，不补 ttl（第 152 行）
    - 文件开头的注释也写明了：手动放置的标记会被保留，自动策略只补剩下的位置
- **最终发出的请求**

```
tools[最后一个]        cache_control: {ephemeral, ttl: 1h}   ← opencode
system[0]              cache_control: {ephemeral, ttl: 1h}   ← opencode
messages:
  user#1  原始提问 + 阶段提醒
  ……（十几万 token 的历史）
  最后一条消息的末尾    cache_control: {ephemeral}            ← 插件，按 5m 算
```

- **两边各自都没错**  
  opencode 尊重手动标记是有意的设计；插件放标记的思路也对（见下一节）  
  问题只在于插件放标记时没有带上 ttl

### 插件为什么要打这个标记

以下是根据代码推测的设计意图，没有向作者求证。

- **看板是"临时尾巴"**
    - 后台任务看板是作为最后一条临时消息追加的，每轮内容都会变
    - 如果交给 opencode 自动处理，末尾断点会落在看板上
    - Anthropic 只在断点位置写缓存，这样每轮写进去的都是"历史加旧看板"，下一轮看板一变就读不到了
- **插件的做法**
    - 把标记挪到看板前面那条稳定的消息上，让历史能被复用
    - 这个思路是对的
- **两个疏漏**
    - **没有带 ttl**  
      模型配了 1h，这个标记仍然是 5m
    - **没有看板时也打标记**  
      此时标记的位置和 opencode 自己会放的位置完全一样，<u>唯一的作用就是把 ttl 弄丢了</u>
- **还有一个排序隐患**（没有实测）
    - 有看板时，断点可能变成 1h → 1h → 5m（插件）→ 1h（opencode 标在看板上）
    - Anthropic 要求长 ttl 的断点排在短 ttl 前面
    - 会不会真出现，要看 system 有几段、断点额度还剩多少
    - 带上 ttl 之后，所有断点 ttl 一致，这个隐患也就不存在了

### 对费用和预热的影响

- **费用估算**  
  假设上游正常保留缓存：工具加 system 约 3 万 token，历史约 15 万 token，离开 10 分钟后回来
    - **有插件标记**  
      读 3 万；历史 15 万按 5m 重新写入，单价 1.25 倍  
      相当于约 19 万 token 的输入费用
    - **全部 1h**  
      读 18 万，单价 0.1 倍  
      相当于约 1.8 万 token 的输入费用
    - **连续工作时反过来**  
      每轮新增的尾部写入，5m 是 1.25 倍，1h 是 2 倍，插件的 5m 反而略便宜  
      但每轮新增只有几千 token，差别很小
- **对预热的影响**（推断，没有实测）
    - opencode 的预热请求走的是 `session.generate`，插件是否会处理这类请求还没有确认
    - 如果会处理：间隔超过 5 分钟的预热只能读到 1h 那一段，历史部分要重新写入  
      opencode 一看"读取量小于写入量"就判定未命中，永久停止预热
    - 也就是说，<u>开着插件时，1h 配上长间隔预热，即使上游完全正常也可能每次都失败</u>

## 本地补丁

### 补丁内容

- **改动文件**  
  只改了 opencode 实际加载的入口 `dist/server/index.js`  
  日志里的 `loading plugin ... entrypoint=.../dist/server/index.js` 可以确认这一点  
  包里的 `dist/index.js` 有同样的代码，但不会被加载，所以没动
- **改动一：打标记时带上 ttl**（`createSessionContextHandler`）
    - 新增依赖 `deps.cacheTTL(event)`，打标记前先查当前模型的 ttl
    - 查到了就写 `{ type: "ephemeral", ttl }`，查不到就保持原来的 `{ type: "ephemeral" }`
- **改动二：查询 ttl**（插件初始化里传给 `createSessionContextHandler` 的参数）
    - 调 `ctx.model.list()`，按 `providerID` 和 `id` 找到当前模型
    - 选了变体时，先看变体的 `settings.cache.ttl`，再看模型的 `settings.cache.ttl`
    - 这和 opencode 自己的预热插件读取 ttl 的方式一致（`packages/core/src/plugin/warming.ts:46`）
    - 查询结果按模型缓存 30 秒，避免每次请求都查一遍
    - 查询超时 2 秒；失败时写日志 `[v2] cache ttl lookup failed`，并退回原来的行为
- **行为对照**
    - 模型配了 ttl：插件标记带上同样的 ttl
    - 模型没配 ttl：和原来完全一样
    - 查询失败：和原来完全一样
    - 修改模型的 ttl 配置后：插件最多 30 秒后改用新值
- **补丁的局限**
    - 插件更新后，缓存目录会被新版本覆盖，补丁随之失效
    - 没有处理"没有看板时不必打标记"这个问题；带上 ttl 之后，它已经没有副作用了
- **文件位置**：都在项目的 `temp/omo-slim-patch/`，不纳入版本库
    - `server-index.js.orig`：原文件备份，SHA256 `485F34AD29E4F9FFA0B2FD9C52DAD3D8DB401FF68394F40B6F6F93866CBF9237`
    - `server-index.js.patched`：打完补丁的文件
    - `server-index.patch`：两者的差异
    - `capture.py`：本地抓包脚本
    - `relay_probe.py`：经本地代理走真实中转站的测试，结果在 `relay-probe-records.json`
    - `replay.py`：抓下 opencode 原样请求，再按变体重放到两个中转站

### 本地验证结果

- **方法**
    - 在本机启动一个返回固定内容的假 Anthropic 服务，不调用真实 API，不花钱
    - 用临时配置把一个测试提供商指向它，`opencode run --standalone --agent orchestrator` 发一条消息
    - 记录请求里每个 `cache_control` 的位置和 ttl
    - 跑完后删除产生的测试会话
- **注意 `--standalone`**  
  不加这个参数时，`opencode run` 会连到后台服务，临时配置不会生效，测试提供商就找不到了
- **结果**：先用原文件跑一遍，再换成补丁文件跑一遍

| 文件 | 模型 ttl | 工具 | system | 对话末尾 |
|---|---|---|---|---|
| 原文件 | 1h | 1h | 1h | **无 ttl** |
| 原文件 | 未设置 | 无 ttl | 无 ttl | 无 ttl |
| 补丁 | 1h | 1h | 1h | **1h** |
| 补丁 | 未设置 | 无 ttl | 无 ttl | 无 ttl |

- **解读**
    - 对话末尾的标记打在阶段提醒那个 part 上，内容开头是 `<system-reminder> !IMPORTANT! Scheduler`，确认是插件打的
    - 补丁只改变了"配了 ttl"的情况，没配 ttl 时行为不变
    - 日志里没有出现 `cache ttl lookup failed`
- **没有覆盖到的情况**
    - 多轮对话、后台任务看板存在时的标记位置
    - 选了变体的模型
    - 这些情况走的是同一段代码，预计没问题，但没有单独测

### 真实中转站验证

- **重启后复测**（11-17 18:58）
    - 新的后台服务 18:56:59 启动，日志里重新出现了 `loading plugin oh-my-opencode-slim`
    - 插件文件的 SHA256 与补丁版本一致，日志里没有 `cache ttl lookup failed`
    - 本地抓包复测结果与上表相同：配了 1h 时，对话末尾也是 1h
- **经 mammotion 的真实会话**（11-17 19:02，Sonnet，每种 2 轮）
    - 本机起一个转发代理，代理在内存里读 key 转发，opencode 的临时配置里只有假 key
    - 原版插件：断点为 1h / 1h / 无 ttl
    - 补丁插件：断点为 1h / 1h / 1h
    - 但两种情况下，mammotion 返回的 1h 写入都是 0，全部记成了 5m
- **这不是补丁的问题**
    - 同一份 opencode 请求发到自建 newapi，全部按 1h 计费
    - mammotion 在 11-13 还能按 1h 计费，11-17 起一律记成 5m
    - 详细数据见 `docs/prompt-cache-report.md` 的"第三轮"
- **自建 newapi 证实了问题的影响**（11-18，详见报告的"第四轮"）
    - 请求形状模拟原版插件：工具和 system 标 1h，对话末尾不带 ttl
    - 6 到 55 分钟之间重发，18 组全部只读回了 1h 段，对话末尾那一段每次都要重写
    - 补丁的作用，就是让这一段也按 1h 保留
- **还没做的端到端验证**
    - 用 opencode 真实会话走 newapi，对比补丁前后超过 5 分钟续聊时的读写量
    - 需要先在配置里加一个指向 newapi 的 `@ai-sdk/anthropic` 类型提供商

### 怎么测试和回滚

- **让补丁生效**
    - 插件由后台服务加载，<u>必须重启后台服务</u>：`opencode service restart`
    - 重启会中断正在运行的会话，请在空闲时操作
    - 重启后在 `~/.local/share/opencode/log/opencode.log` 里搜 `loading plugin`，确认时间在重启之后
- **怎么确认它在起作用**
    - **最可靠：跑本地抓包**  
      `.\.venv\Scripts\python.exe -I temp\omo-slim-patch\capture.py`  
      看 `ttl-1h` 那一行的对话末尾是不是 `1h`；这一步不需要重启服务
    - **日常使用：确认没有副作用**  
      正常用 orchestrator 工作，留意有没有报错，日志里有没有 `cache ttl lookup failed`
    - **不要用 mammotion 的数据来判断**  
      `mammotion-claude` 现在一律按 5m 写入，又会随机分配渠道，看不出补丁的效果  
      要看效果，得用支持 1h 的中转站，比如自建 newapi
- **回滚**
    - 把 `temp/omo-slim-patch/server-index.js.orig` 复制回插件目录的 `dist/server/index.js`
    - 然后重启后台服务
    - 复制回去后可以核对 SHA256，应该等于上面记录的值

## 提交 issue 前的准备

### issue 要点

- **仓库**：`https://github.com/alvinunreal/oh-my-opencode-slim`
- **标题草稿**  
  `Injection cache marker drops the model's cache.ttl, downgrading the conversation tail to 5m`
- **复现步骤**
    - 给一个 Anthropic 模型配置 `cache.ttl: "1h"`
    - 用 orchestrator agent 发一条消息，抓取请求体
    - 对话末尾的 `cache_control` 没有 ttl，而工具和 system 是 `1h`
    - 加上 `disabled_hooks: ["phase-reminder"]` 后，末尾变成 `1h`
- **期望行为**  
  插件放置的标记应该和 opencode 自己放的一样，带上模型配置的 ttl
- **建议的修复**
    - **首选**：打标记时带上模型的 `settings.cache.ttl`，就是本地补丁的做法
    - **补充**：只在确实有临时看板消息时才打这个标记；没有看板时，交给 opencode 自己处理
    - **备选**：请 opencode 在 `context` 事件里直接提供请求的缓存设置，插件就不用再查模型列表
- **附带材料**
    - 原文件的行号：标记在 43002–43011 行，注入判断在 31020–31048 行
    - opencode 侧的相关代码：`cache-policy.ts:152`、`model-request.ts:337`
    - 本地抓包的前后对照表
    - 真实 Anthropic 接口上的影响数据：工具和 system 标 1h、对话末尾不带 ttl 时  
      6 到 55 分钟重发，18 组全部只读回 1h 段，对话末尾那一段每次都要重写
    - 发布前要去掉内部中转站的地址和名称
- **还要先做的事**
    - 本地补丁是改在打包后的 `dist` 上的；npm 包里没有完整的 TypeScript 源码  
      提 issue 或 PR 前，需要先在上游仓库里找到对应的源文件，把改动翻译过去
    - issue 由用户确认后再发布
