"""模型参数模板引擎：完全以 models.dev 模型库为准，按协议 (npm) 生成与协议相关的模型字段。

工具内没有厂商默认表，也不按模型 ID 前缀猜厂商。推理强度列表、interleaved、temperature
全部取自模型库匹配结果（复用 MetadataService.match）。工具自己只维护一张「协议翻译表」
VARIANT_BODIES：把一个推理强度值翻译成该协议下的变体体。

受管字段只有 variants / interleaved / temperature 三项，永远不生成、不触碰模型 options。

单个结果的形状::

    {
        "status": "ok" | "unmatched" | "unsupported_npm",
        "variants": dict | None,           # None = 不改动；dict（可为空）= 整体替换
        "interleaved": bool | str | None,  # None = 不改动；str 为流字段名，与 ModelEntry.interleaved 一致
        "temperature": bool | None,        # None = 不改动
        "remove": list[str],               # 需要显式删除的字段，目前只可能是 "interleaved"
        "notes": list[str],                # 给用户看的说明
    }

规则：
- 未匹配到模型库：status="unmatched"，所有字段 None、remove 为空，即完全不改动。
- temperature：模型库给出布尔值就写入。
- interleaved：只有 @ai-sdk/openai-compatible 需要。该协议下模型库有值则写入，否则放进 remove；
  其它任何协议一律放进 remove（清掉从 openai-compatible 切走后残留的设置）。
- variants：reasoning=false -> {}；有 effort 列表 -> 按翻译表逐个生成；
  openai-compatible 且模型库标了 toggle -> 额外生成 none = {"thinking": {"type": "disabled"}}；
  其余只有 toggle / budget_tokens -> None 并附说明；协议不在翻译表 -> status="unsupported_npm"、variants None。
"""

from __future__ import annotations

from typing import Callable

from backend.errors import ServiceError
from backend.metadata_service import MetadataService

DEFAULT_NPM = "@ai-sdk/openai-compatible"
COMPATIBLE_NPM = "@ai-sdk/openai-compatible"

# 协议翻译表：推理强度 effort -> 变体体。新增协议只需在这里加一行。
VARIANT_BODIES: dict[str, Callable[[str], dict]] = {
    # effort 由 @ai-sdk/anthropic 翻译为 output_config.effort。不能写空 {}：opencode 只给
    # claude-4.6+ / Kimi 内置带 effort 的变体，其它模型（如 DeepSeek）内置的只有 thinking 预算
    "@ai-sdk/anthropic": lambda effort: {"effort": effort},
    "@ai-sdk/openai": lambda effort: {"reasoningEffort": effort},
    "@ai-sdk/openai-compatible": lambda effort: {"reasoningEffort": effort},
    "@ai-sdk/xai": lambda effort: {"reasoningEffort": effort},
    "@ai-sdk/google": lambda effort: {"thinkingConfig": {"thinkingLevel": effort}},
}

# openai-compatible 下「关闭思考」档的变体体；未知参数会被协议包原样放进请求体
THINKING_OFF_BODY = {"thinking": {"type": "disabled"}}


def generate(metadata: MetadataService, item: dict) -> dict:
    """为单个模型生成参数。item: {modelKey, modelId?, providerHint?, npm?}。"""
    if not isinstance(item, dict):
        raise ServiceError("invalid_document", "生成参数的每一项必须是对象")
    model_key = str(item.get("modelKey") or "").strip()
    model_id = item.get("modelId")
    lookup = model_id.strip() if isinstance(model_id, str) and model_id.strip() else model_key
    hint = item.get("providerHint") if isinstance(item.get("providerHint"), str) else None
    npm_raw = item.get("npm")
    npm = npm_raw.strip() if isinstance(npm_raw, str) and npm_raw.strip() else DEFAULT_NPM

    result = _empty(model_key, npm)
    defaults = metadata.match(lookup, hint)
    if not defaults.get("found"):
        result["status"] = "unmatched"
        result["notes"].append("未匹配到模型库，未生成参数")
        return result
    result["matchedProviderId"] = defaults.get("matchedProviderId")
    result["matchedModelId"] = defaults.get("matchedModelId")

    capabilities = defaults.get("capabilities") or {}
    temperature = capabilities.get("temperature")
    if isinstance(temperature, bool):
        result["temperature"] = temperature

    catalog_interleaved = defaults.get("interleaved")
    if npm == COMPATIBLE_NPM and catalog_interleaved not in (None, False):
        result["interleaved"] = catalog_interleaved
    else:
        result["remove"].append("interleaved")

    body = VARIANT_BODIES.get(npm)
    if body is None:
        result["status"] = "unsupported_npm"
        result["notes"].append(f"协议 {npm} 不在翻译表中，未生成变体")
        return result

    efforts = [value for value in defaults.get("reasoningEffortValues") or [] if isinstance(value, str)]
    # 模型库标了 toggle（可关闭思考）且走 openai-compatible 时，补一个关闭思考的 none 档。
    # 统一用 thinking.type=disabled（DeepSeek / Kimi K2.6 / GLM / MiniMax 的写法）；
    # 千问 DashScope（enable_thinking）、vLLM 等写法不同，需要用户手动改，见 docs/api-formats.md
    toggle_off = npm == COMPATIBLE_NPM and "toggle" in (defaults.get("reasoningTypes") or [])
    if capabilities.get("reasoning") is False:
        result["variants"] = {}
    elif efforts or toggle_off:
        variants = {effort: body(effort) for effort in efforts}
        if toggle_off and "none" not in variants:
            variants = {"none": dict(THINKING_OFF_BODY), **variants}
        result["variants"] = variants
    elif defaults.get("reasoningTypes"):
        result["notes"].append("仅支持开关/预算，未生成变体")
    else:
        result["notes"].append("模型库未给出推理强度，未生成变体")
    return result


def generate_many(metadata: MetadataService, items: list) -> list[dict]:
    if not isinstance(items, list):
        raise ServiceError("invalid_document", "生成参数的参数必须是数组")
    return [generate(metadata, item) for item in items]


def _empty(model_key: str, npm: str) -> dict:
    return {
        "modelKey": model_key,
        "npm": npm,
        "status": "ok",
        "matchedProviderId": None,
        "matchedModelId": None,
        "variants": None,
        "interleaved": None,
        "temperature": None,
        "remove": [],
        "notes": [],
    }
