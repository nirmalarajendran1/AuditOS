"""
AuditOS AI Backend — narrative drafting service.

The one place a model credential exists. The prototype under `prototype/` is a
static, offline application served from `file://` or a plain static server;
anything it can read, every user can read, so the Gemini key and the prompt
that constrains the model both live here instead.

Exactly one endpoint does work: `POST /api/narrative`, which drafts the prose
paragraph for a report section from the recorded facts the section is generated
from. It is not a general-purpose model proxy — the request shape is validated,
the section allow-list is closed, and the prompt is assembled server-side so a
browser cannot loosen the grounding constraint.

The service is optional. With it stopped, `prototype/index.html` still opens
by double-click and the report renders exactly as it does with no AI at all;
the narrative is simply absent (AuditOS README — offline / file:// constraint).

Run:
    pip install -r backend/requirements.txt
    cp backend/.env.example backend/.env      # then fill in GEMINI_API_KEY
    uvicorn main:app --host 127.0.0.1 --port 8787 --app-dir backend \
        --reload --reload-dir backend

`--reload` covers code changes. Configuration needs no restart: `.env` is
re-read per request (see `refresh_env`), so adding, removing, or rotating the
key takes effect immediately. `GET /api/health` reports which key state the
running process actually holds.
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH)


def refresh_env() -> None:
    """Re-reads `.env` so configuration edits take effect without a restart.

    `load_dotenv` normally runs once at import, which means editing `.env` in a
    running service changes nothing — the old values stay in `os.environ` and
    the memoized client keeps using the old credential. That is a genuinely
    confusing failure: the file on disk and the service's behaviour disagree,
    with nothing to indicate why.

    Uvicorn's `--reload` does not solve it either; its file watcher ignores
    dotfiles, so `.env` is never seen no matter what `--reload-include` says.
    Re-reading here costs one small file read per request and makes the file on
    disk the truth at all times.
    """
    load_dotenv(ENV_PATH, override=True)

logger = logging.getLogger("auditos.narrative")

PROVIDER = "Google"
DEFAULT_MODEL = "gemini-3.1-flash-lite"

# The only section whose prose this service drafts. `draftNarrative` is called
# for `system-description` alone (report-generation-service.js), and a closed
# list keeps the endpoint from becoming a general text generator.
SUPPORTED_SECTIONS = {"system-description"}

# Bounds on the drafted paragraph. Section III renders as a single <p> above
# five fact blocks, so the useful range is a short paragraph, not an essay.
MAX_OUTPUT_TOKENS = 400
MAX_BLOCKS = 20
MAX_BLOCK_CHARS = 2000

# The grounding constraint. Everything that keeps a drafted narrative honest is
# in here, which is why it is assembled server-side: a browser-resident prompt
# could be edited in the console, and a fabricated figure in a SOC 2 System
# Description is the failure mode that matters most for this product.
SYSTEM_INSTRUCTION = """\
You are an assurance professional drafting the System Description (Section III) \
of a SOC 2 Type II report.

You will be given a list of recorded facts about the engagement. Write ONE \
paragraph of professional audit prose that introduces the system description \
using only those facts.

Absolute rules:
- Use ONLY the facts supplied. Introduce no information that is not present in \
them.
- Every number you state must appear verbatim in the supplied facts. Do not \
compute, round, total, or infer new figures.
- If a fact states that nothing is recorded for a domain, either say so plainly \
or omit that domain. Never invent a value to fill the gap.
- State no conclusion about whether controls are effective, suitably designed, \
or operating. That is the auditor's opinion and belongs to Sections I and II.
- Name no system, vendor, framework, location, or date that is not in the facts.

Format rules:
- Exactly one paragraph. No line breaks, no headings, no bullet points.
- Plain text only. No Markdown, no asterisks, no underscores, no HTML.
- Neutral, factual, past or present tense as the facts warrant.
- Around 60 to 110 words.

Return only the paragraph. Do not preface it or comment on it."""


class NarrativeBlock(BaseModel):
    """One recorded fact, mirroring a block from buildSystemDescriptionBlocks."""

    label: str = Field(default="", max_length=200)
    text: str = Field(default="", max_length=MAX_BLOCK_CHARS)
    present: bool = False


class NarrativeRequest(BaseModel):
    engagementId: str = Field(min_length=1, max_length=200)
    sectionKey: str = Field(min_length=1, max_length=100)
    blocks: List[NarrativeBlock] = Field(min_length=1, max_length=MAX_BLOCKS)


class NarrativeResponse(BaseModel):
    text: str
    provider: str
    model: str
    inputTokens: Optional[int] = None
    outputTokens: Optional[int] = None
    latencyMs: int


app = FastAPI(
    title="AuditOS AI Backend",
    description="Narrative drafting for the AuditOS Reporting workspace.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def model_name() -> str:
    return os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


_client = None
_client_key = None


def gemini_client():
    """The Gemini client for the currently configured key, or None when there
    is none. Memoized against the key itself rather than merely "constructed
    once", so rotating the credential in `.env` takes effect on the next
    request instead of silently continuing to use the old one."""
    global _client, _client_key
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        _client, _client_key = None, None
        return None
    if _client is not None and _client_key == api_key:
        return _client
    from google import genai  # imported lazily so /api/health works uninstalled

    _client = genai.Client(api_key=api_key)
    _client_key = api_key
    return _client


def build_prompt(blocks: List[NarrativeBlock]) -> Optional[str]:
    """The recorded facts, verbatim. Absent facts are labelled, never dropped —
    the model is told what is missing so it can say so instead of inventing.
    Returns None when no block carries text, so the caller rejects the request
    rather than asking the model to write from nothing."""
    lines = []
    for block in blocks:
        text = block.text.strip()
        if not text:
            continue
        marker = "" if block.present else " [NOT RECORDED]"
        label = block.label.strip()
        lines.append(f"- {label}{marker}: {text}" if label else f"- {text}{marker}")
    if not lines:
        return None
    return "Recorded facts for this engagement:\n" + "\n".join(lines)


def enforce_single_paragraph(text: str) -> str:
    """Collapse the model's output to the one plain-text paragraph the renderer
    requires. `reporting.js` assigns the narrative through `textContent` into a
    single <p>, so newlines would render as a run-on and Markdown would display
    as literal punctuation. Enforced here rather than trusted from the model."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```[a-zA-Z]*\n?|```$", "", cleaned).strip()
    cleaned = re.sub(r"^#{1,6}\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"(?<!\w)[*_]{1,2}(.+?)[*_]{1,2}(?!\w)", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


NUMBER_PATTERN = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers_in(text: str) -> set:
    """Every numeric token in `text`, thousands separators normalised away so
    "1,240" and "1240" compare equal."""
    return {match.group(0).replace(",", "") for match in NUMBER_PATTERN.finditer(text)}


def ungrounded_numbers(narrative: str, facts: str) -> List[str]:
    """Figures the narrative states that the recorded facts do not.

    The prompt forbids inventing numbers; this verifies it rather than trusting
    it. A fabricated figure in a SOC 2 System Description is the single worst
    failure this feature can produce — it would read as an audited fact — so an
    ungrounded draft is refused outright and the section keeps its honest
    placeholder instead.

    Digits only. A model writing "three observations" where the facts say "3"
    is not caught here, which is why this backs the prompt rather than replacing
    it, and why a human still approves every draft before it reaches the report.
    """
    allowed = numbers_in(facts)
    return sorted(value for value in numbers_in(narrative) if value not in allowed)


@app.get("/api/health")
def health():
    """Liveness plus readiness. `ai-client.js` calls this to decide whether the
    AI path is available at all; a configured=false response is a normal state,
    not an error, and the browser degrades to today's no-AI behaviour."""
    refresh_env()
    return {
        "status": "ok",
        "provider": PROVIDER,
        "model": model_name(),
        "configured": bool(os.getenv("GEMINI_API_KEY", "").strip()),
    }


@app.post("/api/narrative", response_model=NarrativeResponse)
def narrative(request: NarrativeRequest) -> NarrativeResponse:
    refresh_env()
    if request.sectionKey not in SUPPORTED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported section '{request.sectionKey}'.",
        )

    client = gemini_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured; see backend/.env.example.",
        )

    prompt = build_prompt(request.blocks)
    if prompt is None:
        raise HTTPException(status_code=400, detail="No usable facts supplied.")

    started = time.monotonic()
    try:
        from google.genai import types

        result = client.models.generate_content(
            model=model_name(),
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                temperature=0.2,
            ),
        )
    except Exception as error:  # provider/network failure — never a 500 body
        logger.warning("Gemini request failed: %s", error)
        raise HTTPException(status_code=502, detail="Model request failed.")
    latency_ms = int((time.monotonic() - started) * 1000)

    text = enforce_single_paragraph(getattr(result, "text", "") or "")
    if not text:
        raise HTTPException(status_code=502, detail="Model returned no usable text.")

    invented = ungrounded_numbers(text, prompt)
    if invented:
        logger.warning("Refusing ungrounded draft; figures not in facts: %s", invented)
        raise HTTPException(
            status_code=502,
            detail="Draft stated figures absent from the recorded facts.",
        )

    usage = getattr(result, "usage_metadata", None)
    return NarrativeResponse(
        text=text,
        provider=PROVIDER,
        model=model_name(),
        inputTokens=getattr(usage, "prompt_token_count", None) if usage else None,
        outputTokens=getattr(usage, "candidates_token_count", None) if usage else None,
        latencyMs=latency_ms,
    )
