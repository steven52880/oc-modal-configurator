# 中转站提示缓存测试报告

- **测试日期**
    - 2026-11-13 下午：mammotion 的两轮保留时长测试
    - 2026-11-17 晚：请求格式核对，mammotion 与自建 newapi 对照
    - 2026-11-18 上午：自建 newapi 的 1h 保留时长测试
- **测试对象**
    - `mammotion-claude` 提供商：new-api 中转站，地址 `https://newapi.it-sys.mammotion.com/v1`
    - 自建 newapi：配置里的 `newapi` 提供商，地址 `https://chat.steven53.top/v1`  
      测试时直接调用它的 Anthropic 格式接口 `/v1/messages`
- **客户端环境**：opencode v2.2.7，插件 oh-my-opencode-slim 3.0.7
- **起因**：四个 Claude 模型都已配置 `cache.ttl: "1h"`  
  但离开几分钟后再续聊，缓存总是整段重写，预热也一直中断

## 结论与建议

### 核心结论

- **opencode 发出的请求格式是对的**（11-17 核对）
    - 缓存标记是 `{"type":"ephemeral","ttl":"1h"}`，符合 Anthropic 规范
    - 同一份 opencode 原样请求，自建 newapi 全部按 1h 计费，mammotion 全部记成 5m
    - 去掉 stream、thinking、beta 头之后，两边的结果都不变
- **自建 newapi 的 1h 缓存是真的**（11-18 测试）
    - 6 分钟到 55 分钟之间重发，18 组全部<u>读回了 1h 段、只重写了 5m 段</u>
    - 70 分钟时 2 组都未命中，说明 1h 段按时过期
    - 4 分钟以内 6 组全部命中，没有 mammotion 那样的随机未命中
- **mammotion 现在已经不给 1h 了**（11-17 发现）
    - 11-13 时，同样的请求能拆出 1h 段约 8.4k、5m 段约 5.1k
    - 11-17 原样重跑，变成 1h=0、5m=13417；opencode 的真实请求也一样
    - 也就是说，在 mammotion 上配置 1h <u>完全不起作用</u>
- **mammotion 还有随机分配渠道的问题**（11-13 测试）  
  中转站会把请求随机分给至少两个上游渠道，而缓存只保存在写入时的那个渠道上
    - <u>4 分钟以内</u>重发同样的请求，只有约一半能命中（36 组中 20 组）
    - <u>5 分钟及以上</u>基本失效（32 组中只有 5 组命中）
    - opencode 每次请求都带 `x-session-affinity`，但带不带这个头，命中率没有明显差别
- **插件会让对话历史退回 5 分钟**  
  oh-my-opencode-slim 的阶段提醒会给最后一条消息打一个不带 ttl 的缓存标记，opencode 不会覆盖它
    - 在 newapi 上，这一点会直接造成损失：超过 5 分钟后，这一段必须重写
    - 本机已经打了补丁，详见 `docs/omo-slim-cache-marker.md`
- **预热在 mammotion 上基本无效**  
  预热请求同样会被随机分配渠道，落到没有缓存的渠道就算未命中，opencode 随即停止预热
- **不需要额外的 beta 请求头**  
  带不带 `anthropic-beta: extended-cache-ttl-2025-04-11`，计费拆分完全一样

### 配置建议

- **想要 1h 缓存，Claude 模型改走自建 newapi**
    - 现在的 `newapi` 提供商用的是 `@ai-sdk/openai-compatible`，走 OpenAI 格式  
      这条路上缓存标记能不能生效，没有测过
    - 测试用的是 Anthropic 格式接口，所以需要另加一个 `@ai-sdk/anthropic` 类型的提供商  
      `baseURL` 设为 `https://chat.steven53.top/v1`，Claude 模型设 `cache.ttl: "1h"`
    - 同时保留插件补丁，否则对话历史仍然只缓存 5 分钟
- **继续用 mammotion 的话，缓存时长改回 `5m`，或者不设置**
    - 它现在一律按 5m 写入，配 1h 只是让配置和实际行为对不上
    - 按 Anthropic 官方定价，1h 写入是输入单价的 2 倍，5m 写入是 1.25 倍  
      中转站实际怎么计费没有核实
- **mammotion 上关闭模型级预热**
    - 用 1h 缓存加默认 30 分钟窗口时，opencode 本来就不会预热  
      日志：`not warming: the prompt cache outlives the warming window`
    - 换成其它组合也没用：预热请求只要被分到别的渠道就会中断
- **阶段提醒不用关，打补丁即可**
    - 补丁让插件的标记带上模型配置的 ttl，阶段提醒可以照常使用
    - 插件更新后补丁会被覆盖；没有补丁时，可以在插件配置里加 `"disabled_hooks": ["phase-reminder"]`  
      代价是 orchestrator 每轮少一段调度提醒
- **联系 mammotion 管理员，确认以下几点**
    - Claude 渠道是否在多个账号或渠道之间轮询
    - 能否按 `x-session-affinity` 或 API key 固定渠道
    - 为什么 11-13 还能按 1h 计费，11-17 起一律记成 5m
- **连续工作时，缓存本身是有效的**  
  agent 每隔几秒就发一次请求，很快每个渠道都会写上缓存，所以会话内的命中率能达到 97%～99%  
  损失主要出现在离开几分钟后发出的第一条消息上

### 尚未确认的问题

- **opencode 实际会话走 newapi 的效果还没测**  
  目前是用脚本直接调用 newapi 的接口测出来的  
  要等加好 `@ai-sdk/anthropic` 类型的提供商后，再看真实会话里的缓存读写
- **newapi 报的 token 数会浮动**
    - 同一份请求，newapi 报的写入量在 13.8k～16.4k 之间，mammotion 稳定在 16.95k 左右
    - 同样大小的 1h 段，读回的数字在 5521～6383 之间
    - 所以 newapi 的数字可能是估算值；不过哪一段被读回、哪一段被重写，每组都分得很清楚
- **mammotion 的渠道数量和保留规则不明**
    - 响应里没有 `anthropic-organization-id`，`x-oneapi-request-id` 每次都不同，看不出请求落到了哪个渠道
    - 4 分钟以内的命中率约 56%，大致符合"两个渠道随机分配"，但样本太少，不能排除权重不均或者渠道更多
    - 5 分钟以上偶尔还能命中，可能是个别渠道的缓存保留得更久
- **mammotion 两轮测试同时改了模型和请求头**  
  第一轮用 Opus、不带会话头，第二轮用 Sonnet、带会话头，所以无法把差异归到某一个变量上  
  不过两轮的结论方向一致
- **小请求的计费拆分不稳定**  
  在 mammotion 上，请求总长在 4k～8k token 时，1h 段多次被整体记成了 5m；可早期有一次约 1.7k token 的请求又是按 1h 记的  
  原因没有查明，推测和最小可缓存长度或渠道差异有关  
  opencode 的真实请求远超这个长度，不影响上面的结论
- **中转站的行为会随时间变化**  
  mammotion 从 11-13 到 11-17 就变了一次，newapi 的结论也需要定期复测

## 请求是怎么被缓存的

### opencode 的断点策略

- **缓存规则回顾**
    - Anthropic 按前缀缓存，顺序是 tools → system → messages
    - 一个 `cache_control` 标记就是一个断点：断点之前的全部内容作为一条缓存，每个断点有自己的 ttl
    - 每次请求最多 4 个断点
    - 下一次请求的前缀与之完全相同，才能读到这条缓存
- **opencode 会自动放三类断点**  
  源码在 `packages/ai/src/cache-policy.ts`（提交 `2b2c6054f5`），v2.2.7 二进制里的逻辑与之一致
    - 最后一个工具定义
    - 第一个和最后一个 system 片段
    - 对话末尾的最后一条消息
- **ttl 取自模型配置**
    - 读取模型的 `cache.ttl`：V1 格式写在 `options.cache`，V2 格式写在 `settings.cache`
    - 三类断点共用同一个 ttl；不设置时不写 ttl，按默认的 5 分钟处理
- **已有的标记会被保留**  
  如果某个位置已经带了标记，自动策略会原样保留，不补 ttl（`cache-policy.ts:152`）  
  插件问题就出在这里
- **实际请求形状**  
  在本地抓包，配置 `ttl: 1h`，使用 build agent
    - `tools` 末尾、`system[0]`、最后一条消息，三处都是 `{"type":"ephemeral","ttl":"1h"}`

### 插件写入的无 ttl 断点

- **写入位置**  
  `~/.cache/opencode/npm/oh-my-opencode-slim@latest/.../dist/server/index.js` 第 43002–43011 行
- **触发条件**：本轮请求里有下面任意一种注入
    - 阶段提醒：orchestrator 会话每一轮都有，就是那段 `!IMPORTANT! Scheduler workflow...`
    - council 提示：只有配置了 council 席位才会出现
    - 后台任务看板：只有后台任务正在运行时才会出现
- **写入内容**  
  给最后一条消息的最后一个 part 加上 `cache: { type: "ephemeral" }`，不带 ttl
- **后果**  
  opencode 发现这里已经有标记，就不再处理，于是对话末尾的断点按默认 5 分钟写入
    - tools 和 system 合计只有几万 token，对话历史却有十几万到二十几万 token
    - 所以开着插件时，<u>占大头的对话历史始终只缓存 5 分钟</u>
- **本地抓包对照**（同一份配置，`ttl: 1h`）
    - orchestrator：tools 和 system 是 1h，消息末尾不带 ttl
    - build：三处都是 1h
    - orchestrator 加 `disabled_hooks: ["phase-reminder"]`：三处都是 1h
- **验证范围**  
  关闭开关只在项目级的 `.opencode/oh-my-opencode-slim.json` 里验证过  
  用户级配置文件应该同样有效，但没有实测
- **详细分析与本地补丁**  
  见 `docs/omo-slim-cache-marker.md`（2026-11-17 补充）

### 预热的工作方式

以下逻辑取自 opencode v2.2.7 二进制。

- **什么时候开始**  
  根会话（没有父会话）的一次请求结束后排期；子 agent 的会话不预热
- **间隔与窗口**
    - 间隔设为 `auto` 时，取缓存时长的 90%；没设缓存时长时取 4 分钟
    - 窗口默认 30 分钟，从最后一次活动开始计算
    - 自动间隔不短于窗口时，直接跳过预热  
      日志：`not warming: the prompt cache outlives the warming window`（例如 1h 缓存加默认窗口）
    - 手动设置的间隔不短于窗口时，同样跳过，日志会提示间隔无效
- **预热请求的内容**  
  `This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK`
- **停止条件**  
  只要某次预热的缓存读取量小于写入量，就判定为未命中并永久停止  
  日志：`stopped warming session after a cache miss`
- **配置格式**
    - `ttl` 只接受紧凑写法：`5m`、`1h`
    - 预热的 `interval` 和 `duration` 只接受完整写法：`"4 minutes"`、`"2 hours"`；写成 `1h` 会被悄悄丢弃
- **在 mammotion 上的实际表现**（11-13 的日志）
    - 配置为 1h 缓存、45 分钟间隔后，12:55、12:56、13:49、14:37、14:57 这五次预热全部被判定为未命中而停止
    - 原因就是渠道随机：预热请求落到没有缓存的渠道，自然读不到

### 请求头与中转站

- **opencode 发出的会话相关请求头**  
  每次请求都带，值都是会话 ID
    - `x-session-affinity`、`x-session-id`、`x-opencode-session`、`x-opencode-session-id`
    - 本意是让中转站把同一个会话固定到同一个渠道，但实测 mammotion 不认
- **opencode 发出的 beta 头**  
  `interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01`  
  里面没有 `extended-cache-ttl-2025-04-11`，实测也不需要
- **opencode 请求体里的其它字段**（11-17 抓包，Sonnet）
    - `stream: true`、`max_tokens: 32000`
    - `thinking: {"type":"adaptive","block_binding":{"prefix_mismatch_behavior":"drop_block"}}`
    - 逐个去掉这些字段重发，两个中转站的计费拆分都不变，说明它们和 1h 计费无关
- **mammotion 返回的响应头**
    - `x-new-api-version`、`x-oneapi-request-id`：说明后端是 new-api 系统
    - `cf-aig-*`：说明请求经过了 Cloudflare AI Gateway  
      其中 `cf-aig-cache-status` 是网关自己的响应缓存，和提示缓存无关，不要混淆
    - 没有 `anthropic-organization-id`，无法判断上游用的是哪个账号
- **用量字段的含义**
    - `cache_creation.ephemeral_1h_input_tokens` 和 `ephemeral_5m_input_tokens`：两类缓存写入
    - `cache_read_input_tokens`：缓存读取
    - 在 opencode 的会话记录里，对应的是 `tokens.cache.read` 和 `tokens.cache.write`

## 实测数据

### 测试方法

- **基本思路**  
  每组用一个唯一前缀先写入缓存，等满指定间隔后，再发一次完全相同的请求，看缓存还在不在
- **请求形状**：与 opencode 加插件时的实际请求一致
    - 3 个工具，最后一个标 `ttl: 1h`
    - 1 段 system，标 `ttl: 1h`
    - 3 条消息，最后一个 part 模拟阶段提醒，标记不带 ttl
    - mammotion 在 11-13 把它拆成 <u>1h 段约 8.4k token</u> 和 <u>5m 段约 5.1k token</u>  
      newapi 在 11-18 把它拆成 <u>1h 段约 5.8k token</u> 和 <u>5m 段约 3.1k token</u>
- **结果分类**
    - 全部命中：两段都读回，第二次请求没有重写任何内容
    - 仅 1h 段命中：读回 1h 段，5m 段重写；这才是"1h 缓存真的生效"的证据
    - 未命中：读取为 0，两段都整体重写
    - newapi 报的 token 数会浮动，所以第四轮改为按"第二次请求重写了哪一段"来分类
- **并发规则**
    - 第一轮 5 路并行，同一间隔的几组不同时运行
    - 第二轮和第四轮 10 路并行，同一间隔的几组启动时间至少错开 60 秒
- **安全措施**  
  API key 只在脚本内存里读取，不打印也不写入文件；每轮结束后都检查过 `temp/` 下的全部文件，不含 key
- **请求量**
    - 第一轮约 96 次 Opus 请求（含冒烟测试），第二轮约 48 次 Sonnet 请求，每次约 1.35 万 token
    - 第三轮约 28 次 Sonnet 请求，每次约 1.3 万～1.7 万 token
    - 第四轮 52 次 Sonnet 请求，另有冒烟测试 2 次、被中断的一次尝试约 12 次，每次约 0.9 万 token

### 第一轮：mammotion，Opus，不带会话头

- **时间**：17:16–17:53
- **模型**：`claude-opus-5-5`
- **组数**：15 个间隔，每个间隔 3 组

✓ 表示两段都命中，✗ 表示未命中、整体重写。

| 间隔 | 组 A | 组 B | 组 C | 命中 |
|---|---|---|---|---|
| 10s | ✗ | ✗ | ✗ | 0/3 |
| 20s | ✗ | ✓ | ✓ | 2/3 |
| 30s | ✓ | ✗ | ✓ | 2/3 |
| 45s | ✓ | ✓ | ✓ | 3/3 |
| 1m | ✗ | ✗ | ✓ | 1/3 |
| 1.5m | ✗ | ✓ | ✗ | 1/3 |
| 2m | ✓ | ✗ | ✗ | 1/3 |
| 3m | ✓ | ✗ | ✗ | 1/3 |
| 4m | ✓ | ✓ | ✓ | 3/3 |
| 5m | ✗ | ✗ | ✗ | 0/3 |
| 6m | ✗ | ✗ | ✗ | 0/3 |
| 7m | ✗ | ✗ | ✗ | 0/3 |
| 8m | ✗ | ✗ | ✓ | 1/3 |
| 9m | ✗ | ✗ | ✓ | 1/3 |
| 10m | ✗ | ✗ | ✗ | 0/3 |

- **4 分钟以内**：14/27 命中  
  命中与否和间隔长短无关：10 秒一组都没中，45 秒和 4 分钟却全中
- **5 分钟及以上**：2/18 命中
- **写入拆分很稳定**：1h 段 8385～8435 token，5m 段 5081～5089 token

### 第二轮：mammotion，Sonnet，带会话头

- **时间**：18:32–18:47
- **模型**：`claude-sonnet-5-5`
- **请求头**：带上 opencode 实际会发的全部会话头，每组使用不同的会话 ID
- **组数**：5m 是分界点，多测了 2 组

| 间隔 | 组 A | 组 B | 组 C | 组 D | 组 E | 命中 |
|---|---|---|---|---|---|---|
| 30s | ✓ | ✗ | ✓ | — | — | 2/3 |
| 2m | ✗ | ✓ | ✓ | — | — | 2/3 |
| 4m | ✗ | ✓ | ✓ | — | — | 2/3 |
| 5m | ✗ | ✗ | ✓ | ✗ | ✗ | 1/5 |
| 6m | ✗ | ✓ | ✗ | — | — | 1/3 |
| 8m | ✗ | ✗ | ✗ | — | — | 0/3 |
| 10m | ✓ | ✗ | ✗ | — | — | 1/3 |

- **4 分钟以内**：6/9 命中；另外，正式测试前的一组 30 秒冒烟测试也没命中
- **5 分钟及以上**：3/14 命中
- **带上会话头之后，短间隔仍然有三分之一没命中**，说明中转站并没有按会话固定渠道

### mammotion 两轮对比与解读

| 测试 | 4 分钟以内 | 5 分钟及以上 |
|---|---|---|
| Opus，不带会话头 | 14/27（52%） | 2/18（11%） |
| Sonnet，带会话头 | 6/9（67%） | 3/14（21%） |
| 合计 | 20/36（56%） | 5/32（16%） |

- **短间隔只有一半命中，而且和间隔长短无关**  
  如果是缓存过期，间隔越短应该越容易命中，实际并非如此  
  更合理的解释是：<u>请求被随机分到了不同渠道</u>
- **会话头没有明显提高命中率**  
  6/9 和 14/27 的差距在小样本的误差范围之内
- **5 分钟是明显的分界线**  
  多数渠道大约在 5 分钟时丢掉缓存
- **超过 5 分钟还能命中时，5m 段也还在**  
  说明这种命中不是 1h ttl 在起作用，而是个别情况下整条缓存活得更久
- **和真实会话的数据吻合**
    - 连续工作时，请求密集，很快每个渠道都写上了缓存，所以命中率很高
    - 离开超过 5 分钟后，只有两成左右的机会能命中

### 第三轮：请求格式核对

- **时间**：11-17 19:02–19:10
- **起因**  
  给插件打补丁后，用 opencode 的真实 orchestrator 会话经 mammotion 测试  
  补丁让对话末尾的标记带上了 1h，但 mammotion 返回的 1h 写入仍然是 0
- **opencode 真实会话**（mammotion，Sonnet，每种各 2 轮）
    - 原版插件：断点为 1h / 1h / 无 ttl，写入 `1h=0`、`5m≈9.6k～9.7k`
    - 补丁插件：断点为 1h / 1h / 1h，写入 `1h=0`、`5m≈8.1k～9.6k`
    - 补丁确实改了请求，但 mammotion 把所有写入都记成了 5m
- **请求变体对照**  
  先在本机抓下 opencode 的原样请求，再逐项删减后分别发到两个中转站  
  每次都在前缀最前面插入唯一标记，确保整段都要重新写入

| 请求变体 | mammotion | 自建 newapi |
|---|---|---|
| opencode 原样请求 | 1h=0，5m≈16.9k | 1h≈14.6k～15.2k，5m=0 |
| 去掉 stream | 1h=0 | 1h |
| 去掉 thinking | 1h=0 | 1h |
| 去掉 beta 头 | 1h=0 | 1h |
| 只留模型、工具、system、消息 | 1h=0 | 1h |

- **每种变体在每个中转站上跑 2 轮**，20 次请求结果完全一致，没有报错
- **mammotion 旧请求复测**  
  把 11-13 能拆出 1h 的 `probe2.py` 原样重跑一次：写入 `1h=0`、`5m=13417`
- **结论**
    - opencode 的请求格式没有问题，问题在 mammotion
    - mammotion 在 11-13 到 11-17 之间发生了变化，现在一律按 5m 写入
    - 原样请求里没有 5m 段，是因为这次抓的是首轮请求，三个断点都是 1h

### 第四轮：自建 newapi 的 1h 保留时长

- **时间**：11-18 11:05–12:16
- **模型**：`claude-sonnet-5-5`，请求形状与前两轮相同，不带会话头
- **组数**：9 个间隔，70 分钟档 2 组，其余每档 3 组，共 26 组，没有报错
- **实际间隔**：每组的等待时间都与计划完全一致

| 间隔 | 结果 | 第二次请求读回 | 第二次请求重写 |
|---|---|---|---|
| 30s | 3/3 全部命中 | 约 8.9k～9.6k | 无 |
| 4m | 3/3 全部命中 | 约 8.9k～9.6k | 无 |
| 6m | 3/3 仅 1h 段 | 约 5.8k～6.4k | 5m 段约 3.1k～3.4k |
| 10m | 3/3 仅 1h 段 | 约 5.9k～6.0k | 5m 段约 3.1k～3.2k |
| 20m | 3/3 仅 1h 段 | 约 5.8k～5.9k | 5m 段约 3.1k |
| 30m | 3/3 仅 1h 段 | 约 5.7k～5.9k | 5m 段约 3.1k～3.2k |
| 45m | 3/3 仅 1h 段 | 约 5.7k～6.0k | 5m 段约 3.1k～3.2k |
| 55m | 3/3 仅 1h 段 | 约 5.5k～6.0k | 5m 段约 3.0k～3.2k |
| 70m | 2/2 未命中 | 0 | 两段全部重写 |

- **完全符合 Anthropic 的规则**
    - 5m 段在 5 分钟后过期，1h 段一直保留到 55 分钟，70 分钟时已经过期
    - 短间隔 6 组全部命中，说明 newapi 没有随机分配渠道的问题
- **插件问题在这里看得很清楚**  
  测试里那个 5m 段，对应的就是插件打的无 ttl 标记  
  在真实会话里它是十几万 token 的对话历史，超过 5 分钟就要按 5m 重新写入
- **第一次尝试被中断**  
  11-17 19:16 第一次启动，约 19:24 被终止，只完成了一组 30 秒的测试（两段都命中）  
  推测是测试挂在 opencode 的后台 shell 下，被连带结束；11-18 改用独立进程重跑

### mammotion 的其他实测

- **beta 头对照**（Opus，完整请求形状，带和不带各 3 次）  
  6 次的写入拆分完全一致：1h 段约 10.85k token，5m 段约 5.03k token
- **小请求的反常现象**
    - 冒烟阶段请求总长 4k～8k token 时，三次都把 1h 段整体记成了 5m
    - 把工具和 system 加长到约 8.4k token 后，两段才分开计费
    - 早期几次 1.7k～3.3k token 的小请求，有时记 1h，有时记 5m
- **7.5 分钟单次复测**（16:49 写入，16:56 重发，Opus）
    - 插件形状（消息末尾不带 ttl）：读取为 0
    - 全部标 1h：读取同样为 0
- **真实会话数据**（11-13 改成 1h 之后，来自 opencode 会话记录）
    - 续聊间隔分别为 8.3、19.1、25.7、33.9、38.0、62.1 分钟，读取全部为 0，整段重写
    - 连续工作时，命中率在 97%～99%
    - 偶尔会读到 7333 token 的小额命中  
      推测是其它会话写入的公共前缀（工具加基础系统提示）

## 附录

### 排查中纠正过的结论

排查过程中，有几条结论先被提出、后来又被推翻。留在这里，避免以后重复踩坑。

- **"中转站缺 beta 头，把 1h 降成了 5m"**：错误  
  这条结论来自几次小请求；换成完整请求形状后，带不带 beta 头结果完全一致
- **"oh-my-opencode-slim 与缓存无关"**：错误  
  当时只搜了 `cache_control` 和 `ttl`，没想到插件写的是 opencode 内部的 `cache` 字段  
  其实第一次抓包时就已经拍到了不带 ttl 的消息断点，但被忽略了
- **"opencode 带了会话亲和头，所以实际使用时不会随机分渠道"**：错误  
  第二轮带上会话头测试，命中率和不带时差不多
- **"5 分钟以内的未命中是缓存过期造成的"**：错误  
  10 秒间隔也会未命中，45 秒和 4 分钟间隔却能全部命中
- **"1h 缓存没有带来实际收益，与请求里写的 ttl 无关"**：只对 mammotion 成立  
  这是 11-13 根据 mammotion 的数据得出的；自建 newapi 上，1h 段稳定保留到 55 分钟
- **"opencode 的真实请求 1h 写入为 0，可能是请求格式有问题"**：错误  
  同一份请求发到自建 newapi 全部按 1h 计费；问题在 mammotion 一律记成 5m
- **"补丁后 1h 写入应该占大头"**：在 mammotion 上不成立  
  补丁确实让请求带上了 1h，但 mammotion 不认；这个预期要在支持 1h 的中转站上才成立
- **以本文的"核心结论"为准**

### 复现方法与文件位置

- **文件**：在项目的 `temp/` 目录下，不纳入版本库
    - `cacheprobe/probe.py`：第一轮测试脚本（mammotion，Opus，不带会话头，15 个间隔，每个间隔 3 组）
    - `cacheprobe/probe2.py`：第二轮测试脚本（mammotion，Sonnet，带会话头）
    - `cacheprobe/probe3.py`：第四轮测试脚本（自建 newapi，Sonnet，30 秒到 70 分钟）
    - `cacheprobe/results.jsonl`、`probe2-results.jsonl`、`probe3-results.jsonl`：每组测试的原始结果
    - `cacheprobe/*summary.txt`、`*progress.log`：汇总和运行日志；`probe3-run1-interrupted-*` 是被中断那次的残留
    - `omo-slim-patch/replay.py`：第三轮的抓包和变体重放脚本，结果在 `replay-results.jsonl`
    - `omo-slim-patch/relay_probe.py`：第三轮的 opencode 真实会话测试，经本地代理转发
- **运行方式**
    - 冒烟测试：`.\.venv\Scripts\python.exe -I temp\cacheprobe\probe3.py --smoke`  
      跑一组 30 秒间隔的测试，共 2 次请求；`probe2.py` 用法相同
    - 完整测试：去掉 `--smoke`  
      修改脚本里的 `PLAN`、`MODEL`、`WORKERS`，可以调整间隔、模型和并发数
    - 变体重放：先 `replay.py capture`，再 `replay.py run --target mammotion` 或 `--target newapi`
- **长时间测试要用独立进程启动**  
  挂在 opencode 后台 shell 下的测试可能被连带结束；第四轮改用 `Win32_Process` 的 `Create` 方法启动  
  进度看对应的 `*progress.log`，每组写入后都会先记一行
- **注意事项**
    - 脚本会从 `~/.config/opencode/opencode.json` 读取 key，会产生真实费用  
      `probe.py`、`probe2.py` 读 `mammotion-claude`，`probe3.py` 读 `newapi`
    - 请求总长要足够大，否则 1h 段可能被整体记成 5m，两段就区分不开了；mammotion 上约需 13k token
    - 每组都用唯一前缀，不会命中其它测试或真实会话的缓存
- **本地抓包方法**  
  在本机启动一个返回固定 SSE 的假 Anthropic 服务，用临时 `opencode.json` 把 baseURL 指向它  
  再用 `opencode run --standalone --archived` 发一条消息，就能看到 opencode 实际发出的请求体和请求头  
  不加 `--standalone` 时会连到后台服务，临时配置不生效；跑完后记得删除这次产生的会话
