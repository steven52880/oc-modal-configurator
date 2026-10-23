# 四种 LLM API 格式对比

对比对象：OpenAI Chat Completions（下称 Chat，即"OpenAI 兼容"格式）、OpenAI Responses、Anthropic Messages、Gemini generateContent。

内容以各家官方公开 API 为准（截至 2025–2026）。中转服务（如 NewAPI）通常只实现其中一部分，实际可用参数以中转实例为准。多模态部分只描述 API 格式本身能表达什么，不区分具体后端模型。

## 1. 基本形态

| 维度 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 端点 | `POST /v1/chat/completions` | `POST /v1/responses` | `POST /v1/messages` | `POST /v1beta/models/{model}:generateContent`，流式为 `:streamGenerateContent?alt=sse` |
| 鉴权 | `Authorization: Bearer <key>` | 同 Chat | `x-api-key` + `anthropic-version`，可选 `anthropic-beta` | `x-goog-api-key` 或 `?key=` |
| 对话状态 | 无状态，每次发送完整 `messages` | 可选有状态：`store` + `previous_response_id` / `conversation`；也可无状态发送完整 `input` | 无状态 | 无状态（缓存另有独立资源） |
| 系统提示 | `messages` 中的 `system` / `developer` 角色 | `instructions` 字段或 `developer` 角色 item | 顶层 `system` 字段 | 顶层 `systemInstruction` |
| 输入结构 | `messages[{role, content}]` | `input`：字符串或 item 数组 | `messages[{role, content[]}]`，user / assistant 必须交替 | `contents[{role:"user"\|"model", parts[]}]` |
| 输出结构 | `choices[].message` | `output[]`：message / reasoning / function_call 等 item | `content[]`：text / thinking / tool_use 等 block | `candidates[].content.parts[]` |
| 通用性 | 最高，几乎所有厂商与中转都兼容 | OpenAI 官方、Azure 及少数中转 | Anthropic 官方，DeepSeek / Kimi / GLM / MiniMax / Qwen 等提供兼容口 | Google AI Studio、Vertex AI |

## 2. 生成参数

| 参数 | Chat | Responses | Anthropic | Gemini（`generationConfig`） |
|---|---|---|---|---|
| 最大输出 | `max_completion_tokens`（旧名 `max_tokens`） | `max_output_tokens` | `max_tokens`（必填） | `maxOutputTokens` |
| temperature / top_p | 支持（推理模型多数不收） | 支持（推理模型多数不收） | 支持（开启 thinking 时受限） | 支持 |
| top_k | 不支持 | 不支持 | 支持 | 支持 |
| 停止词 | `stop` | 不支持 | `stop_sequences` | `stopSequences` |
| presence / frequency penalty | 支持 | 不支持 | 不支持 | 支持 |
| 多候选 | `n` | 不支持 | 不支持 | `candidateCount` |
| logprobs | 支持 | 有限（`include` 中请求） | 不支持 | `responseLogprobs` |
| seed | 支持 | 不支持 | 不支持 | `seed` |
| 结构化输出 | `response_format: {type:"json_schema"}` | `text.format: {type:"json_schema"}` | 无专用字段，通常用强制工具调用实现 | `responseMimeType` + `responseSchema` |
| 输出详细度 | 不支持 | `text.verbosity` | 不支持 | 不支持 |
| 后台 / 异步执行 | 不支持 | `background: true` | 另有 Batch API | 另有 Batch API |

## 3. 会话 ID 与上下文缓存

你听说的"会话 ID"主要指 OpenAI 的 `prompt_cache_key`。它不是会话本身，而是一个路由提示：同一个 key 的请求会尽量落到同一批缓存机器上，提高前缀缓存命中率。opencode 的 `setCacheKey: true` 就是把当前会话 ID 填进这个字段。

| 维度 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 缓存方式 | 自动前缀缓存 | 自动前缀缓存 | 显式断点：在 block 上标 `cache_control: {type:"ephemeral", ttl}` | 隐式自动缓存 + 显式 `cachedContents` 资源 |
| 缓存路由键（会话 ID） | `prompt_cache_key` | `prompt_cache_key` | 无对应字段 | 无对应字段 |
| 缓存保留时长 | `prompt_cache_retention`（如 `24h`） | 同 Chat | `ttl`：`5m`（默认）或 `1h` | `cachedContents` 的 `ttl` / `expireTime` |
| 服务端会话状态 | 无 | `previous_response_id`：引用上一次响应，无需重发历史；`conversation`：绑定持久会话对象 | 无 | 无（请求里用 `cachedContent: "cachedContents/xxx"` 引用缓存） |
| 用户标识（非缓存用途） | `safety_identifier`（旧名 `user`） | 同 Chat | `metadata.user_id` | 无 |
| 用量回报 | `usage.prompt_tokens_details.cached_tokens` | `usage.input_tokens_details.cached_tokens` | `cache_creation_input_tokens`、`cache_read_input_tokens` | `usageMetadata.cachedContentTokenCount` |
| 计费特点 | 命中部分打折，写入不额外收费 | 同 Chat | 写入比原价贵（5m 约 1.25 倍，1h 约 2 倍），读取约 0.1 倍 | 隐式缓存命中打折；显式缓存另按存储时长收费 |

补充说明：

- Anthropic 的 `metadata.user_id` 用于滥用检测，不影响缓存命中。
- 第三方 Chat 兼容口（DeepSeek、Kimi、GLM 等）一般也是自动前缀缓存，通常不认 `prompt_cache_key`。个别厂商有自己的扩展参数，需查各自文档。
- `previous_response_id` 要求上一次请求开启 `store`（默认开启）。开启 ZDR（零数据保留）或设置 `store: false` 时只能无状态回传。

## 4. 推理（思考）对比

| 维度 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 开关 / 强度 | 官方：`reasoning_effort`；厂商扩展：`thinking:{type}`、`enable_thinking`、`thinking_budget` 等 | `reasoning.effort`：none / minimal / low / medium / high / xhigh | `thinking:{type:"enabled", budget_tokens}`；新模型支持 `{type:"adaptive"}` + `output_config.effort` | `thinkingConfig.thinkingBudget`（2.5 系列）或 `thinkingLevel`（3 系列） |
| 思考内容可见性 | OpenAI 官方不返回；第三方用非标准字段 `reasoning_content` / `reasoning` | `reasoning.summary` 返回摘要；`include:["reasoning.encrypted_content"]` 返回加密原文 | `thinking` block，明文或摘要，带 `signature`；可能出现 `redacted_thinking` | `includeThoughts:true` 返回思考摘要 part（`thought:true`） |
| 多轮回传 | 无标准；DeepSeek / Kimi 等要求回传 `reasoning_content` | 回传 reasoning item（加密），或用 `previous_response_id` 自动带上 | 必须原样回传 thinking block 与 `signature` | 回传 `thoughtSignature` |
| 工具调用间思考 | 视厂商 | 原生 | 需 beta 头 `interleaved-thinking-2025-05-14`（新模型默认） | 原生 |
| 用量字段 | `completion_tokens_details.reasoning_tokens` | `output_tokens_details.reasoning_tokens` | 计入 `output_tokens` | `thoughtsTokenCount` |

### 4.1 OpenAI Chat Completions

Chat 格式诞生时还没有推理模型，所以没有标准的推理表达。OpenAI 官方只加了一个 `reasoning_effort` 参数控制强度，思考内容完全不返回，多轮之间也无法延续推理，每一轮都从零开始思考。

第三方厂商各自扩展了这个格式：

- DeepSeek：`thinking: {type: "enabled" | "disabled"}` + `reasoning_effort: low | high | max`。思考内容放在 `message.reasoning_content`。带工具调用的多轮对话中，必须把上一轮的 `reasoning_content` 回传，否则报错或效果下降。
- Kimi：K2.x 用 `thinking.type` 开关；K3 始终思考，用 `reasoning_effort` 调强度。同样使用 `reasoning_content`，并要求回传。温度固定，不应传 `temperature`。
- 智谱 GLM：`thinking: {type: "enabled" | "disabled"}`，默认开启，部分模型支持 `clear_thinking` 控制是否保留历史思考。
- Qwen（百炼）：顶层 `enable_thinking: true` + `thinking_budget`（token 上限）。
- vLLM / SGLang 自部署：通常把思考放在 `reasoning` 或 `reasoning_content` 字段，取决于 reasoning parser 配置。

这类扩展的问题是"非标准"：客户端必须知道具体厂商用哪个字段，中转也可能直接丢弃不认识的参数和字段。opencode 的 `interleaved: {field: "reasoning_content"}` 配置就是为了告诉客户端回传哪个字段。

### 4.2 OpenAI Responses

Responses 是 OpenAI 为推理模型设计的格式，把推理当作一等公民：

- 强度：`reasoning.effort`，档位最全，包括 `none`（关闭推理）和 `xhigh`。
- 可见性：原始思考链不对外公开。`reasoning.summary`（`auto` / `concise` / `detailed`）返回一段可读摘要，适合在界面展示。
- 延续推理：推理结果以 `reasoning` item 的形式出现在 `output[]` 中。有两种方式在下一轮带上：
  1. 有状态：上一次请求 `store: true`，下一次传 `previous_response_id`，服务端自动拼接，包括推理。
  2. 无状态：设置 `store: false` + `include: ["reasoning.encrypted_content"]`，拿到加密的推理内容，下一轮原样放回 `input`。opencode 对 OpenAI 默认使用这种方式。
- 工具调用与推理天然交错：模型可以"思考 → 调工具 → 继续思考 → 再调工具"，且推理在工具调用之间不丢失。

这是 GPT 推理模型效果最好的格式。用 Chat 格式调用同一个模型，每轮都丢失推理上下文，长任务的表现会下降。

### 4.3 Anthropic Messages

Anthropic 的推理叫 extended thinking：

- 开关与预算：`thinking: {type: "enabled", budget_tokens: N}`，`budget_tokens` 必须小于 `max_tokens`。新一代模型支持 `{type: "adaptive"}`，由模型自行决定思考多少，再通过 `effort`（low / medium / high / max 等）调整倾向。
- 可见性：响应中出现 `thinking` block。较早的模型返回完整思考，较新的模型多返回摘要；被安全系统拦截的部分以 `redacted_thinking`（加密）形式返回。
- 签名：每个 thinking block 带 `signature`。多轮回传时必须原样保留 thinking block 与签名，特别是带工具调用的轮次，否则 API 报错。签名防止客户端篡改思考内容。
- 交错思考：工具调用之间继续思考需要 beta 头 `interleaved-thinking-2025-05-14`，较新的模型默认支持。
- 限制：开启 thinking 时，`temperature` 只能保持默认，`top_k` 不可用，`tool_choice` 只能是 `auto` 或 `none`。

### 4.4 Gemini generateContent

Gemini 的推理通过 `generationConfig.thinkingConfig` 控制：

- 强度：2.5 系列用 `thinkingBudget`（token 数；`0` 关闭，部分模型不能关；`-1` 动态）。3 系列改用 `thinkingLevel`（如 `low` / `high`）。
- 可见性：`includeThoughts: true` 时，响应 `parts` 中会出现带 `thought: true` 标记的思考摘要 part。不开启则不返回，但仍然在思考并计费。
- 延续推理：响应 part 上带 `thoughtSignature`（加密的推理状态）。多轮对话特别是函数调用场景，需要把带签名的 part 原样回传，模型才能接上之前的推理。3 系列对此要求更严格，缺失签名的函数调用回传可能被拒绝。
- 计费：`usageMetadata.thoughtsTokenCount` 单独列出思考 token。

### 4.5 小结

四种格式的推理能力可以按"能否把推理状态带到下一轮"区分：

- Responses、Anthropic、Gemini 都有官方机制回传推理（加密内容、签名或服务端状态），适合长链路 agent 任务。
- Chat 没有官方机制，只能依赖厂商私有字段；用 Chat 访问 GPT 推理模型时，每轮推理都会丢失。
- 跨格式转换（例如中转把 Anthropic 请求转成 Chat 发给上游）时，签名、加密推理和私有字段很难无损转换，推理参数最容易在这一步失效。

## 5. 工具调用

| 维度 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 定义 | `tools[{type:"function", function:{name, description, parameters}}]` | `tools[{type:"function", name, description, parameters, strict}]`（扁平） | `tools[{name, description, input_schema}]` | `tools[{functionDeclarations:[{name, description, parameters}]}]` |
| 模型发起调用 | `message.tool_calls[]`，`arguments` 为 JSON 字符串 | `function_call` item，`arguments` 为 JSON 字符串 | `tool_use` block，`input` 为对象 | `functionCall` part，`args` 为对象 |
| 回填结果 | `role:"tool"` 消息 + `tool_call_id` | `function_call_output` item + `call_id` | user 消息中的 `tool_result` block + `tool_use_id` | `functionResponse` part |
| 强制调用 | `tool_choice`：auto / none / required / 指定函数 | 同 Chat | `tool_choice`：auto / any / tool / none | `toolConfig.functionCallingConfig.mode`：AUTO / ANY / NONE |
| 并行调用 | `parallel_tool_calls` | `parallel_tool_calls` | `disable_parallel_tool_use` | 默认支持 |
| 严格模式 | `strict: true` | `strict: true` | `strict: true`（较新） | 无 |
| 内置工具 | 基本没有 | web_search、file_search、code_interpreter、computer_use、image_generation、remote MCP | web_search、web_fetch、code_execution、computer use、bash、text_editor、MCP connector（多数需 beta） | googleSearch、codeExecution、urlContext、googleMaps |

## 6. 多模态（仅 API 格式层面）

| 能力 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 图片输入 | `image_url` part（URL 或 base64 data URL） | `input_image`（URL / base64 / file_id） | `image` block（base64 / URL / Files API） | `inlineData` / `fileData` |
| PDF / 文件输入 | `file` part（base64 或 file_id） | `input_file` | `document` block | `inlineData` / `fileData`（`application/pdf`） |
| 音频输入 | `input_audio` part | 无专用类型 | 无 | `inlineData` / `fileData`（audio/*） |
| 视频输入 | 无 | 无 | 无 | `inlineData` / `fileData`（video/*），支持 YouTube URL |
| 文件上传服务 | Files API | Files API | Files API（beta） | File API |
| 音频输出 | `modalities:["text","audio"]` + `audio` 参数 | 无（另有 Realtime API） | 无 | `responseModalities:["AUDIO"]` |
| 图片输出 | 无 | 通过 `image_generation` 工具 | 无 | `responseModalities:["IMAGE"]` |

格式层面 Gemini 支持面最广，是唯一原生支持视频输入的格式；Anthropic 只能输入图片和文档，只能输出文本。

## 7. 其它功能

| 功能 | Chat | Responses | Anthropic | Gemini |
|---|---|---|---|---|
| 引用 / 溯源 | 无 | web search 输出 `annotations` | `citations`（文档与搜索） | `groundingMetadata`、`citationMetadata` |
| 安全设置 | 无（另有 Moderation API） | 无 | 无 | `safetySettings` |
| 预填充回答 | 不支持 | 不支持 | 支持：最后一条 assistant 消息作为开头（thinking 开启时不可用） | 不支持 |
| token 计数 | 无专用端点 | `/v1/responses/input_tokens` | `/v1/messages/count_tokens` | `:countTokens` |

## 8. 流式输出

| 格式 | 事件形式 |
|---|---|
| Chat | `data: {choices[].delta}` 逐块，以 `data: [DONE]` 结束；需 `stream_options.include_usage` 才返回用量 |
| Responses | 语义化事件：`response.created`、`response.output_text.delta`、`response.reasoning_summary_text.delta`、`response.function_call_arguments.delta`、`response.completed` 等 |
| Anthropic | `message_start` → `content_block_start` → `content_block_delta`（`text_delta` / `thinking_delta` / `signature_delta` / `input_json_delta`）→ `content_block_stop` → `message_delta` → `message_stop` |
| Gemini | 每个 SSE 事件是一个完整的部分 `GenerateContentResponse` |

## 9. 选型建议

- 第三方开源/国产模型（DeepSeek、Kimi、GLM、Qwen）：用 Chat，并正确配置厂商私有推理参数和 `reasoning_content` 回传。
- GPT 推理模型：优先 Responses，前提是中转实现了 `/v1/responses`。
- Claude：用 Anthropic，才能完整使用 thinking 签名、`cache_control` 和 PDF 输入。
- Gemini：用原生格式，才能使用视频与音频输入、`thoughtSignature` 和搜索溯源。

## 10. opencode 配置中的推理参数

本节是本工具「生成参数」功能（`backend/param_templates.py`）的依据。源码基线为 opencode v1.19.3（`provider.ts`、`transform.ts`、`packages/ai/src/protocols/*`），厂商行为以 DeepSeek、Kimi 官方文档为准。

### 10.1 配置如何变成请求

`variants` / `options` 里写的不是 HTTP 字段，而是 AI SDK 协议包的 providerOptions（camelCase）。协议包再翻译成接口字段：

| 协议 (npm) | 配置里写 | 实际请求体 |
|---|---|---|
| `@ai-sdk/openai-compatible` | `reasoningEffort: "high"` | `reasoning_effort: "high"` |
| `@ai-sdk/openai-compatible` | `thinking: {type: "disabled"}`（协议包不认识的键） | 原样透传：`thinking: {type: "disabled"}` |
| `@ai-sdk/openai` | `reasoningEffort`、`reasoningSummary`、`include` | Responses 的 `reasoning.effort`、`reasoning.summary`、`include` |
| `@ai-sdk/anthropic` | `effort: "high"` | `output_config: {effort: "high"}` |
| `@ai-sdk/anthropic` | `thinking: {type, budgetTokens}` | `thinking: {type, budget_tokens}` |
| `@ai-sdk/google` | `thinkingConfig: {thinkingLevel, includeThoughts}` | `generationConfig.thinkingConfig` |

所以 openai 兼容协议下写 `reasoningEffort` 是对的，直接写 `reasoning_effort` 反而不保证生效。

配置里的变体不会替换 opencode 内置变体，而是逐档深度合并（`mergeDeep`）：

- 内置有、配置没写的档仍然存在。例如 openai 兼容协议下 DeepSeek V4 内置有 `low/medium/high/max`，配置只写 `low/high/max` 时 `medium` 仍会出现。
- 配置写成空 `{}` 的档，内容完全来自内置变体；内置没有这一档时，选它等于什么都不发。
- 某档写 `{"disabled": true}` 可以隐藏它。
### 10.2 生成器的规则

强度档位、`interleaved`、`temperature` 全部来自 models.dev 匹配结果，工具不维护厂商表，只维护一张「协议 → 变体体」翻译表：

| 协议 | 每个强度档生成 |
|---|---|
| `@ai-sdk/openai-compatible` / `@ai-sdk/openai` / `@ai-sdk/xai` | `{reasoningEffort: <档>}` |
| `@ai-sdk/anthropic` | `{effort: <档>}` |
| `@ai-sdk/google` | `{thinkingConfig: {thinkingLevel: <档>}}` |

其它规则：

- 模型库 `reasoning: false`：清空变体。
- 只有 `budget_tokens`（如 Claude Sonnet 4.5、Haiku 4.5）：不改变体，使用 opencode 内置的 `high`/`max` 预算档。
- openai 兼容协议且模型库标了 `toggle`：额外生成关闭思考档 `none: {thinking: {type: "disabled"}}`，放在最前；模型库已有 `none` 档时不覆盖。其它协议只有 `toggle` 时不改变体。
- `interleaved` 只在 openai 兼容协议下写入，切到其它协议时删除。
- 未匹配到模型库：完全不改动。

### 10.3 各厂商要点

| 厂商 / 模型 | openai 兼容协议 | anthropic 协议 | 备注 |
|---|---|---|---|
| DeepSeek V4 | `thinking.type` 开关 + `reasoning_effort: low/high/max`，默认开启、`high` | `output_config.effort` | 传入 `medium` 映射为 `high`，`xhigh` 映射为 `high`。思考模式下 `temperature` 等采样参数不生效但不报错 |
| Kimi K3 | `reasoning_effort: low/high/max`，默认 `max` | `effort` | 始终思考，不能关；不支持 `thinking` 参数 |
| Kimi K2.6 | 只有 `thinking.type` 开关，默认开启 | 同左 | 不能调强度；多轮保留思考需 `thinking.keep: "all"`（写在 options，不是变体） |
| Kimi K2.7 Code | 始终思考，传 `disabled` 报错 | 同左 | 不生成任何变体 |
| GLM-5.x | `reasoning_effort`；`thinking.type` 开关 | `effort` | GLM-5.3 关闭思考返回 400，模型库也未标 `toggle` |
| Claude 4.6+ | — | 内置 `thinking: adaptive` + `effort` | 工具生成 `{effort}` 与内置一致 |
| Claude 4.5 及以前 | — | 内置 `thinking.budgetTokens` | 只有预算，没有强度 |

Kimi 和 DeepSeek 的温度都是固定值，模型库标 `temperature: false`，生成器会写入。

### 10.4 边角情况

- **anthropic 协议下的非 Claude 模型**：opencode 只给 Claude 4.6+ 和 Kimi 内置带 `effort` 的变体，其它模型（DeepSeek、GLM 等）内置只有 `high`/`max` 两个 `thinking.budgetTokens` 档。因此工具必须显式写 `{effort}`，空 `{}` 会导致 `low` 档什么都不发。合并后 `high`/`max` 同时带 `effort` 和 `budget_tokens`，服务端是否忽略预算未经验证。
- **关闭思考写法不统一**：生成器统一写 `thinking.type: "disabled"`，适用于 DeepSeek、Kimi K2.6、GLM、MiniMax。千问 DashScope 用 `enable_thinking: false`，vLLM / SGLang 自部署通常用 `chat_template_kwargs`，这些需要手动把 `none` 档改成对应写法。
- **中转是否透传**：`thinking` 是非标准参数，中转（如 NewAPI）可能丢弃，需实际请求确认。
- **DeepSeek 的 `reasoning_content` 回传**：带工具的会话必须回传所有历史 `reasoning_content`，否则 400。opencode 对 openai 兼容协议下 ID 含 `deepseek` 的模型自动补 `interleaved: reasoning_content`，并给每条 assistant 消息补空推理，所以模型库条目缺这个字段也不影响。同一会话中在思考和不思考之间切换是否报错，未经验证。
- **模型库匹配到第三方条目**：官方条目找不到时会用第三方提供商的条目，档位可能不准。例如 `claude-opus-4-1` 匹配到 requesty，生成了 Anthropic 不支持的 `none` 档。点号写法的 ID（如 `claude-sonnet-4.5`）可能匹配不到，此时不改动。
- **切换协议后的残留**：只有开关或预算的模型，在非 openai 兼容协议下不改变体，从别的协议切过来时旧的 `{reasoningEffort}` 档会留着且无效，需手动删除。
- **openai 协议的非内置档**：opencode 内置的 GPT 变体带 `reasoningSummary: "auto"` 和加密推理 `include`，但只覆盖内置档位；模型库新增、opencode 未内置的档（如 `max`）只有工具写的 `reasoningEffort`，拿不到推理摘要和加密推理回传。
