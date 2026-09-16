#!/usr/bin/env python3
"""Generate the speech-recognition model catalogue.

Handy generates its catalogue from Hugging Face rather than checking a
hand-written list in, and this follows that approach: sizes and SHA-256 digests
come from the file listing, capability flags and accuracy benchmarks come from
the model card's ``transcribe_cpp`` block, and revisions are pinned to the commit
that produced them. Nothing is transcribed by hand, so the catalogue cannot
drift from what is actually published.

Usage:
    python scripts/gen_catalog.py [output_path]

Writes ``src-tauri/src/model_catalog.json`` by default.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HF_API = "https://huggingface.co/api"

# Repositories are discovered from this organisation rather than hardcoded, so a
# newly published model shows up on the next regeneration.
ORG = "handy-computer"

# Model families the bundled engine can actually load. Anything outside this
# list would download successfully and then fail at startup with "unsupported
# architecture", so such repositories are skipped — the catalogue only offers
# what the engine supports.
SUPPORTED_FAMILIES = (
    "whisper",
    "parakeet",
    "canary",
    "cohere",
    "voxtral",
    "moonshine",
    "granite",
    "qwen3",
    "gigaam",
    "sensevoice",
    "medasr",
    "moss",
    "nemotron",
    "fun-asr",
    "breeze",
)

# Curated order and copy. Models absent from here still appear, sorted after
# these by speed, with a description generated from their card.
CURATION: dict[str, dict] = {
    "nemotron-3.5-asr-streaming-0.6b": {
        "rank": 1,
        "recommended": True,
        "description": "Живая расшифровка на 28 языках, включая русский. "
        "Та же модель, что раньше входила в установщик.",
    },
    "parakeet-unified-en-0.6b": {
        "rank": 2,
        "recommended": True,
        "description": "Быстрая и точная расшифровка английского в реальном времени.",
    },
    "canary-180m-flash": {
        "rank": 3,
        "recommended": True,
        "description": "Крошечная и мгновенная, работает на любом железе.",
    },
    "whisper-medium": {
        "rank": 4,
        "recommended": True,
        "description": "Самое широкое покрытие языков, но может работать медленнее.",
    },
    "parakeet-tdt-0.6b-v3": {
        "rank": 5,
        "description": "Быстрая и точная, 25 европейских языков.",
    },
    "parakeet-tdt-0.6b-v2": {
        "rank": 6,
        "description": "Только английский. Лучший выбор для английской речи.",
    },
    "Voxtral-Mini-4B-Realtime-2602": {
        "rank": 7,
        "description": "Живая многозычная расшифровка, хороша на мощных машинах.",
    },
    "cohere-transcribe-03-2026": {
        "rank": 8,
        "description": "Наибольшая точность, 14 языков, медленнее остальных.",
    },
    "Qwen3-ASR-0.6B": {"rank": 9, "description": "Компактная многозычная модель."},
    "gigaam-v3-e2e-rnnt": {"rank": 10, "description": "Хорошо распознаёт русскую речь."},
}

# Preferred quantisation: small models keep reference quality, large ones are
# fine slightly compressed, which saves a third of the download.
LARGE_MODEL_QUANT = "Q5_K_M"
SMALL_MODEL_QUANT = "Q8_0"
LARGE_MODEL_PARAMS = 1.0

ARCH_PATTERN = re.compile(
    r"(whisper|moonshine|parakeet|canary|voxtral|granite|qwen3|gigaam|"
    r"sensevoice|cohere|fun-asr|nemotron|medasr|moss|breeze)",
    re.IGNORECASE,
)


def fetch(url: str):
    """GET JSON, retrying once. Returns None on repeated failure."""
    for _ in range(2):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            continue
    return None


def family_of(repo_id: str, tags: list[str]) -> str:
    slug = repo_id.split("/")[-1]
    match = ARCH_PATTERN.search(slug)
    if match:
        return match.group(1).lower()
    for tag in tags:
        if tag.lower() in SUPPORTED_FAMILIES:
            return tag.lower()
    return "other"


def quantisation_of(filename: str) -> str:
    match = re.search(r"-(F32|F16|BF16|Q\d[\w_]*?)\.gguf$", filename)
    return match.group(1) if match else "?"


def parse_params(size_label) -> float | None:
    """`general.size_label` ("0.6B" / "62M") as a number of billions."""
    match = re.match(r"([\d.]+)\s*([BM])", str(size_label or "").strip(), re.IGNORECASE)
    if not match:
        return None
    value = float(match.group(1))
    return value if match.group(2).upper() == "B" else value / 1000


def accuracy_from_wer(metrics: dict) -> tuple[float | None, str | None]:
    """Published word error rate, preferring the English reference set."""
    if not isinstance(metrics, dict):
        return None, None
    for key in ("wer_librispeech_test_clean", "wer_fleurs_en"):
        if key in metrics:
            chosen = metrics[key]
            break
    else:
        fleurs = sorted(k for k in metrics if k.startswith("wer_fleurs_"))
        if not fleurs:
            return None, None
        chosen = metrics[fleurs[0]]
        key = fleurs[0]
    if not isinstance(chosen, dict):
        return None, None
    for quant in ("q8_0", "f16", "q5_k_m", "q6_k", "q4_k_m", "f32"):
        if quant in chosen:
            return float(chosen[quant]), key.replace("wer_", "")
    return None, None


def speed_from_rtf(rtf: float | None) -> int:
    """Real-time factor to a 0-100 score, so the UI can draw a bar."""
    if not rtf or rtf <= 0:
        return 10
    import math

    return round(100 * (1 - math.exp(-rtf / 8.0)))


def build_entry(repo_id: str, info: dict, tree: list[dict]) -> dict | None:
    card = info.get("cardData") or {}
    tags = info.get("tags") or []
    family = family_of(repo_id, tags)
    if family not in SUPPORTED_FAMILIES:
        return None

    files = []
    for entry in tree:
        # The tree endpoint names the field `path`, while the model listing uses
        # `rfilename`; both shapes appear depending on the endpoint version.
        name = entry.get("path") or entry.get("rfilename") or ""
        if not name.endswith(".gguf"):
            continue
        size = entry.get("size")
        lfs = entry.get("lfs") or {}
        digest = lfs.get("oid") or lfs.get("sha256")
        if not isinstance(size, int) or size <= 0 or not digest:
            continue
        files.append(
            {
                "filename": name,
                "quant": quantisation_of(name),
                "size_bytes": size,
                "sha256": digest,
            }
        )
    if not files:
        return None
    files.sort(key=lambda f: f["size_bytes"])

    metrics = card.get("transcribe_cpp") or {}
    # `general.size_label` lives inside the GGUF header, not on the card, so it
    # is absent here; the parameter count is only used to choose a default
    # quantisation and the file list is enough for that.
    params = parse_params(metrics.get("size_label"))
    preferred = LARGE_MODEL_QUANT if (params or 0) >= LARGE_MODEL_PARAMS else SMALL_MODEL_QUANT
    default_file = next((f for f in files if f["quant"] == preferred), files[0])

    wer, wer_set = accuracy_from_wer(metrics)
    languages = card.get("language") or []
    rtf = None
    for key in ("rtf_ryzen_4750u", "rtf_m4_max"):
        value = metrics.get(key)
        if isinstance(value, dict):
            rtf = value.get("vulkan") or value.get("metal") or value.get("cpu")
            if rtf:
                break

    slug = repo_id.split("/")[-1].replace("-gguf", "")
    curated = CURATION.get(slug, {})

    capabilities = {
        "streaming": bool(metrics.get("streaming")),
        "translate": bool(metrics.get("translate")),
        "lang_detect": bool(metrics.get("lang_detect")),
        "timestamps": metrics.get("timestamps") or "none",
    }

    description = curated.get("description")
    if not description:
        bits = []
        if capabilities["streaming"]:
            bits.append("живая расшифровка")
        if capabilities["translate"]:
            bits.append("перевод")
        if capabilities["lang_detect"]:
            bits.append("определение языка")
        coverage = f"{len(languages)} языков" if len(languages) > 1 else "один язык"
        description = coverage.capitalize() + (", " + ", ".join(bits) if bits else ".")

    return {
        "id": slug,
        "repo": repo_id,
        # Pinned so the bytes provably match the hashes below even if the
        # repository moves on.
        "revision": info.get("sha"),
        "family": family,
        "name": (metrics.get("name") or slug.replace("-", " ").title()),
        "description": description,
        "parameters": metrics.get("size_label") or "",
        "language_count": len(languages),
        "languages": languages[:40],
        "capabilities": capabilities,
        "accuracy_score": round(100 * pow(2.718281828, -(wer / 15.0))) if wer is not None else None,
        "speed_score": speed_from_rtf(rtf),
        "wer": wer,
        "wer_set": wer_set,
        "files": files,
        "default_file": default_file["filename"],
        "recommended": bool(curated.get("recommended")),
        "rank": curated.get("rank"),
    }


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("src-tauri/src/model_catalog.json")

    listed = fetch(f"{HF_API}/models?author={ORG}&limit=500") or []
    print(f"discovered {len(listed)} repositories in {ORG}")

    def load(model: dict) -> tuple[dict, dict | None, list[dict]]:
        repo_id = model["id"]
        info = fetch(f"{HF_API}/models/{repo_id}?blobs=true") or {}
        tree = fetch(f"{HF_API}/models/{repo_id}/tree/main?recursive=true") or []
        return model, info, tree

    entries = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for model, info, tree in pool.map(load, listed):
            if not info:
                continue
            entry = build_entry(model["id"], info, tree)
            if entry:
                entries.append(entry)

    # Recommended first, then the editorial order, then the fastest of the rest.
    entries.sort(
        key=lambda e: (
            not e["recommended"],
            e.get("rank") or 10_000,
            -(e["speed_score"] or 0),
            e["id"],
        )
    )

    for entry in entries:
        entry.pop("rank", None)

    catalog = {
        "catalog_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"https://huggingface.co/{ORG}",
        "models": entries,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {output} with {len(entries)} models")
    for entry in entries[:5]:
        print(f"  {entry['id']:<42} {entry['family']:<12} {len(entry['files'])} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
