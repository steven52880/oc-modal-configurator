import json
import os
import tempfile
import unittest
from pathlib import Path

from backend.bridge import Bridge
from backend.config_service import ConfigService, document_from_raw, to_raw
from backend.fields import model_prefix
from backend.metadata_service import MetadataService
from backend.paths import PROJECT_ROOT, catalog_cache_path
from backend.provider_probe import models_url, parse_models_payload
from backend.secrets import describe_api_key, resolve_secret
from backend.settings_store import SettingsStore


ROOT = PROJECT_ROOT
SAMPLE = ROOT / "api.json"
USER_CONFIG = Path.home() / ".config" / "opencode" / "opencode.json"


def redact(value):
    if isinstance(value, dict):
        return {
            key: ("<redacted>" if str(key).lower() in {"apikey", "api_key"} else redact(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


class ConfigTests(unittest.TestCase):
    def test_round_trip_preserves_unknown_fields_and_interleaved_shape(self):
        raw = {
            "plugin": ["package"],
            "$schema": None,
            "provider": {
                "demo": {
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {
                        "baseURL": "https://example.test/v1",
                        "apiKey": "{env:DEMO_KEY}",
                        "setCacheKey": False,
                        "timeout": False,
                        "headers": {"X-Test": "1"},
                        "custom": {"keep": True},
                    },
                    "models": {
                        "demo-model": {
                            "name": "Demo",
                            "interleaved": {"field": "reasoning_content"},
                            "limit": {"context": 128000, "output": 4096, "input": 1000},
                            "modalities": {"input": ["text", "image"], "output": ["text"]},
                            "variants": {"low": {"reasoningEffort": "low"}, "high": {}},
                            "attachment": False,
                            "tool_call": True,
                            "cost": {"input": 1, "output": 2, "tiers": [{"input": 3}]},
                            "family": "demo",
                            "unknownFlag": True,
                        }
                    },
                }
            },
        }
        document = document_from_raw(raw, Path("demo.json"), True, 1)
        self.assertEqual(document["providers"][0]["models"][0]["interleaved"], "reasoning_content")
        self.assertEqual(to_raw(document), raw)

    def test_save_writes_backup_and_detects_external_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.json"
            service = ConfigService(path)
            document = service.load()
            document["providers"] = [
                {
                    "key": "local",
                    "name": "Local",
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {"baseURL": "https://example.test/v1", "apiKey": "secret", "setCacheKey": True},
                    "optionsExtra": {},
                    "extra": {},
                    "models": [],
                }
            ]
            saved = service.save(document)
            self.assertIsNone(saved["backupPath"])
            self.assertTrue(path.is_file())
            document["mtimeNs"] = saved["mtimeNs"]
            backed_up = service.save(document)
            self.assertTrue(Path(backed_up["backupPath"]).is_file())
            document["mtimeNs"] = backed_up["mtimeNs"]
            path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            with self.assertRaises(Exception) as caught:
                service.save(document)
            self.assertEqual(caught.exception.code, "conflict")
            forced = service.save(document, force=True)
            self.assertTrue(forced["backupPath"].endswith(".bak"))

    def test_duplicate_provider_key_is_rejected(self):
        document = document_from_raw({}, Path("new.json"), False, None)
        document["providers"] = [
            {"key": "same", "name": None, "npm": None, "options": {}, "optionsExtra": {}, "extra": {}, "models": []},
            {"key": "same", "name": None, "npm": None, "options": {}, "optionsExtra": {}, "extra": {}, "models": []},
        ]
        with self.assertRaises(Exception) as caught:
            to_raw(document)
        self.assertEqual(caught.exception.code, "validation_error")

    def test_user_config_round_trip_when_present(self):
        if not USER_CONFIG.is_file():
            self.skipTest("no user opencode.json")
        raw = json.loads(USER_CONFIG.read_text(encoding="utf-8-sig"))
        document = document_from_raw(raw, USER_CONFIG, True, 1)
        produced = to_raw(document)
        self.assertEqual(redact(produced), redact(raw))
        self.assertEqual(
            produced["provider"][next(iter(raw["provider"]))]["options"]["apiKey"],
            raw["provider"][next(iter(raw["provider"]))]["options"]["apiKey"],
        )


class SettingsTests(unittest.TestCase):
    def test_single_file_merge_and_quarantine(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            store = SettingsStore(path)
            saved = store.update({"splitRatio": 0.55, "window": {"width": 1600, "height": 1000}})
            self.assertEqual(saved["splitRatio"], 0.55)
            self.assertEqual(saved["window"]["width"], 1600)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 1)
            path.write_text("{", encoding="utf-8")
            restored = store.load()
            self.assertEqual(restored["splitRatio"], 0.4)
            self.assertTrue(any(item.name.startswith("settings.json.bad") for item in path.parent.iterdir()))

    def test_runtime_cache_is_outside_the_repository(self):
        previous = os.environ.pop("OC_APP_CONFIG_DIR", None)
        try:
            cache = catalog_cache_path().resolve()
            self.assertNotEqual(cache, (ROOT / "api.json").resolve())
            self.assertNotIn(str(ROOT.resolve()), str(cache))
        finally:
            if previous is not None:
                os.environ["OC_APP_CONFIG_DIR"] = previous


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.cache = root / "api.json"
        self.meta = root / "api.meta.json"
        self.cache.write_text(json.dumps(MINI_CATALOG), encoding="utf-8")
        self.service = MetadataService(self.cache, self.meta)

    def tearDown(self):
        self.directory.cleanup()

    def test_provider_hint_wins_when_that_catalog_record_is_useful(self):
        found = self.service.match("gpt-6-astra", "azure")
        self.assertEqual(found["matchKind"], "provider")
        self.assertEqual(found["matchedProviderId"], "azure")

    def test_official_exact_record_beats_a_thinner_copy(self):
        found = self.service.match("gpt-6-astra")
        self.assertEqual(found["matchedProviderId"], "openai")
        self.assertEqual(found["matchKind"], "exact")
        self.assertEqual(found["variants"], {"low": {}, "high": {}})
        self.assertEqual(found["limit"]["context"], 100)

    def test_alias_follows_canonical_official_record(self):
        found = self.service.match("deepseek-flash", "mammotion")
        self.assertEqual(found["matchKind"], "canonical")
        self.assertEqual(found["matchedProviderId"], "deepseek")
        self.assertEqual(found["matchedModelId"], "deepseek-v4-flash")
        self.assertEqual(found["limit"]["context"], 1048576)

    def test_missing_model_and_empty_catalog_search(self):
        self.assertFalse(self.service.match("missing-model")["found"])
        empty = MetadataService(Path(self.directory.name) / "absent.json", self.meta)
        status = empty.status()
        self.assertEqual(status["origin"], "empty")
        self.assertFalse(status["available"])
        self.assertEqual(self.service.status()["sources"][0]["id"], "models.dev")
        listed = self.service.search(query="flash")
        self.assertEqual(listed["groups"][0]["prefix"], "deepseek")

    def test_reload_local_picks_up_a_file_placed_after_startup(self):
        cache = Path(self.directory.name) / "placed.json"
        meta = Path(self.directory.name) / "placed.meta.json"
        service = MetadataService(cache, meta)
        self.assertEqual(service.status()["origin"], "empty")
        cache.write_text(json.dumps(MINI_CATALOG), encoding="utf-8")
        reloaded = service.reload_local()
        self.assertTrue(reloaded["available"])
        self.assertGreater(reloaded["modelCount"], 0)
        self.assertTrue(service.match("gpt-6-astra")["found"])

    def test_sample_catalog_is_readable_but_not_the_default_cache(self):
        if not SAMPLE.is_file():
            self.skipTest("development sample is absent")
        before = SAMPLE.stat().st_mtime_ns
        sample = MetadataService(SAMPLE, Path(self.directory.name) / "sample.meta.json")
        found = sample.match("gpt-6-astra", "mammotion-openai")
        self.assertTrue(found["found"])
        self.assertEqual(found["matchedProviderId"], "openai")
        self.assertIsInstance(found["limit"]["context"], int)
        alias = sample.match("deepseek-flash")
        self.assertTrue(alias["found"])
        self.assertIsInstance(alias["limit"]["context"], int)
        self.assertEqual(SAMPLE.stat().st_mtime_ns, before)
        self.assertFalse((ROOT / "api.meta.json").exists())


class ProbeAndSecretTests(unittest.TestCase):
    def test_models_url_and_payload(self):
        self.assertEqual(models_url("https://example.test/v1/"), "https://example.test/v1/models")
        self.assertEqual(models_url("https://example.test/v1/models"), "https://example.test/v1/models")
        parsed = parse_models_payload({"data": [{"id": "gpt-6-astra", "owned_by": "openai"}, "kimi-k2"]})
        self.assertEqual([item["id"] for item in parsed], ["gpt-6-astra", "kimi-k2"])
        self.assertEqual(model_prefix("openai/gpt-6-astra"), "gpt")
        self.assertEqual(model_prefix("~deepseek/deepseek-flash-latest"), "deepseek")

    def test_secret_preview_does_not_return_the_value(self):
        with tempfile.TemporaryDirectory() as directory:
            key_file = Path(directory) / "key.txt"
            key_file.write_text("super-secret\n", encoding="utf-8")
            described = describe_api_key("{file:%s}" % key_file)
            self.assertEqual(described["kind"], "file")
            self.assertNotIn("super-secret", json.dumps(described))
            self.assertEqual(resolve_secret("{file:%s}" % key_file), "super-secret")
        os.environ["OC_TEST_TOKEN"] = "env-secret"
        try:
            self.assertEqual(resolve_secret("{env:OC_TEST_TOKEN}"), "env-secret")
            self.assertNotIn("env-secret", json.dumps(describe_api_key("{env:OC_TEST_TOKEN}")))
        finally:
            del os.environ["OC_TEST_TOKEN"]


class BridgeTests(unittest.TestCase):
    def test_load_save_uses_isolated_settings_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bridge = Bridge(
                ConfigService(root / "opencode.json"),
                MetadataService(root / "cache.json", root / "cache.meta.json"),
                SettingsStore(root / "settings.json"),
            )
            loaded = bridge.load_config(str(root / "opencode.json"))
            self.assertTrue(loaded["ok"])
            document = loaded["data"]
            document["preserved"] = {"plugin": ["keep"]}
            document["providers"] = [
                {
                    "key": "local",
                    "name": "Local",
                    "npm": "@ai-sdk/openai",
                    "options": {"baseURL": "https://example.test/v1", "apiKey": "{env:DEMO_KEY}", "setCacheKey": True},
                    "optionsExtra": {},
                    "extra": {},
                    "models": [{"key": "gpt-6-astra", "name": "Astra", "extra": {}, "meta": {}, "options": {}, "variants": {}}],
                }
            ]
            saved = bridge.save_config(document)
            self.assertTrue(saved["ok"], saved)
            self.assertEqual(json.loads((root / "settings.json").read_text(encoding="utf-8"))["lastConfigPath"], str(root / "opencode.json"))
            again = bridge.load_config(str(root / "opencode.json"))
            self.assertEqual(again["data"]["preserved"]["plugin"], ["keep"])
            self.assertEqual(again["data"]["providers"][0]["models"][0]["key"], "gpt-6-astra")


MINI_CATALOG = {
    "openai": {
        "id": "openai",
        "npm": "@ai-sdk/openai",
        "name": "OpenAI",
        "models": {
            "gpt-6-astra": {
                "id": "gpt-6-astra",
                "name": "GPT 6 Astra",
                "canonical_model_id": "openai/gpt-6-astra",
                "attachment": True,
                "reasoning": True,
                "tool_call": True,
                "temperature": True,
                "modalities": {"input": ["text", "image"], "output": ["text"]},
                "limit": {"context": 100, "output": 50, "input": 80},
                "cost": {"input": 2, "output": 10},
                "reasoning_options": [{"type": "effort", "values": ["high", "low"]}],
                "family": "gpt",
            }
        },
    },
    "azure": {
        "id": "azure",
        "npm": "@ai-sdk/azure",
        "name": "Azure",
        "models": {
            "gpt-6-astra": {
                "id": "gpt-6-astra",
                "name": "azure copy",
                "canonical_model_id": "openai/gpt-6-astra",
                "limit": {"context": 1, "output": 1},
            },
            "deepseek-flash": {
                "name": "alias",
                "canonical_model_id": "deepseek/deepseek-v4-flash",
            },
        },
    },
    "deepseek": {
        "id": "deepseek",
        "npm": "@ai-sdk/openai-compatible",
        "name": "DeepSeek",
        "models": {
            "deepseek-v4-flash": {
                "name": "DeepSeek Flash",
                "canonical_model_id": "deepseek/deepseek-v4-flash",
                "limit": {"context": 1048576, "output": 8192},
                "modalities": {"input": ["text"], "output": ["text"]},
                "reasoning_options": [{"type": "effort", "values": ["none", "high"]}],
            }
        },
    },
}


if __name__ == "__main__":
    unittest.main()
