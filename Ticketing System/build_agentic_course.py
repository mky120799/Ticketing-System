"""Hands-off course builder: transcript parts -> OpenAI (with automatic quality gate) -> Notion.

What it does, for every part in ~/Desktop/agentic_ai_transcript/<chapter>/part-N.txt:
  1. Sends the master prompt + the transcript part to the OpenAI API.
  2. Handles "⏸ ... reply continue" automatically until the part is complete.
  3. Runs a QUALITY GATE in Python (not trusting the model): coverage-map rows, words per
     transcript minute, banned shortcuts ("etc.", "..." in code, "the instructor explains"),
     ❌ in the audit, missing diagram, too few interview answers.
     If it fails, it tells the model exactly what failed and asks for a full rewrite (max 3 tries).
  4. Saves markdown to ~/Desktop/agentic_ai_course_md/ and appends it to Notion
     (hub page -> one page per chapter -> "Part N" sections).
  5. Remembers progress in state.json, so you can stop and re-run any time.

Setup (once):
    python3 -m venv .venv && source .venv/bin/activate
    pip install openai requests
    export OPENAI_API_KEY="sk-..."             # platform.openai.com -> API keys (billed separately from ChatGPT Plus)
    export OPENAI_MODEL="gpt-5"                # any strong model your API account has
    export NOTION_TOKEN="ntn_..."              # notion.so/my-integrations -> New integration -> copy secret
    export NOTION_PARENT_PAGE_ID="<page id>"   # a Notion page you shared with that integration (••• -> Connections)
Run:
    python build_agentic_course.py --max-parts 1     # try one part first and check it in Notion
    python build_agentic_course.py                   # then let it run everything
    python build_agentic_course.py --dry-run         # no Notion, markdown files only
    python build_agentic_course.py --extras          # after all parts: cheat sheet, mock interview, study plan
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRANSCRIPT_DIR = Path.home() / "Desktop" / "agentic_ai_transcript"
OUT_DIR = Path.home() / "Desktop" / "agentic_ai_course_md"
STATE_FILE = OUT_DIR / "state.json"
PROMPT_FILE = HERE / "agentic-ai-course-prompt.md"

MAX_ATTEMPTS = 3
MAX_CONTINUES = 6
CONTINUE_MARKER = "⏸"
HUB_TITLE = "Agentic AI — Complete Course (freeCodeCamp) — Detailed Notes"

AUTOMATION_RULES = """
## AUTOMATION MODE (overrides section 4 and 7 of the prompt above)
- You have NO tools and NO Notion access. Output ONLY the notes as markdown. A script saves them to Notion.
- Never ask me questions and never wait for confirmation. Every reply = Stage A + Stage B + Stage C for the part given.
- Use exactly these top-level headings: `## Stage A — Coverage map`, `## Stage B — Detailed notes`, `## Stage C — Detail audit`.
- Coverage map must be a markdown table whose first two columns are `#` and `Timestamp` (format HH:MM:SS).
- Toggles: use `<details><summary>Question</summary>` ... `</details>` with a blank line after `<summary>` line.
- Diagrams: use a ```mermaid fenced code block.
- The transcript is auto-generated: silently fix obvious caption errors (pideantic = Pydantic, langraph = LangGraph, aent = agent, lang chain = LangChain).
- In the audit, write the line `WORD COUNT: <number>` for Stage B.
"""

BANNED = [
    (r"\betc\.", '"etc."'),
    (r"\band so on\b", '"and so on"'),
    (r"\brest of the code\b", '"rest of the code"'),
    (r"\bsimilar(ly)? to (the )?above\b", '"similar to above"'),
    (r"\bas discussed\b", '"as discussed"'),
    (r"\bleft as an exercise\b", '"left as an exercise"'),
    (r"\bthe instructor (explains|discusses|talks about|covers)\b", '"the instructor explains X" (explain X itself)'),
    (r"\byou can explore (more|further)\b", '"you can explore more"'),
]


# ----------------------------------------------------------------------------- helpers
def load_master_prompt() -> str:
    text = PROMPT_FILE.read_text(encoding="utf-8")
    master = text.split("# PER-PART MESSAGE")[0]
    return master + AUTOMATION_RULES


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"hub_id": None, "chapters": {}, "done": [], "report": {}}


def save_state(state: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def list_parts() -> list[Path]:
    def part_no(p: Path) -> int:
        return int(re.search(r"part-(\d+)", p.name).group(1))

    parts = []
    for chapter in sorted(d for d in TRANSCRIPT_DIR.iterdir() if d.is_dir()):
        parts += sorted(chapter.glob("part-*.txt"), key=part_no)
    return parts


def part_minutes(header: str) -> float:
    m = re.search(r"\((\d\d):(\d\d):(\d\d)-(\d\d):(\d\d):(\d\d)\)", header)
    if not m:
        return 20.0
    h1, m1, s1, h2, m2, s2 = map(int, m.groups())
    return max(1.0, ((h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1)) / 60)


def section(md: str, start: str, end: str | None) -> str:
    i = md.find(start)
    if i < 0:
        return ""
    j = md.find(end, i) if end else -1
    return md[i: j if j > 0 else len(md)]


# ----------------------------------------------------------------------------- quality gate
def quality_problems(md: str, minutes: float) -> list[str]:
    problems: list[str] = []
    stage_a = section(md, "## Stage A", "## Stage B")
    stage_b = section(md, "## Stage B", "## Stage C")
    stage_c = section(md, "## Stage C", None)
    if not (stage_a and stage_b and stage_c):
        problems.append("Missing one of the headings '## Stage A — Coverage map', '## Stage B — Detailed notes', '## Stage C — Detail audit'.")

    rows = re.findall(r"^\|\s*\d+\s*\|\s*\[?\d{1,2}:\d{2}", stage_a, flags=re.M)
    min_rows = int(minutes * 1.2)
    if len(rows) < min_rows:
        problems.append(f"Coverage map has {len(rows)} rows for {minutes:.0f} transcript minutes; at least {min_rows} expected (one row per distinct idea, code line group, demo step, tip).")

    words = len(re.findall(r"\w+", stage_b))
    min_words = int(minutes * 100)
    if words < min_words:
        problems.append(f"Stage B has about {words} words; at least {min_words} required (1,000 per 10 minutes). Explain every coverage row in depth.")

    if "❌" in stage_c:
        problems.append("The audit contains ❌ rows. Write the missing content for those rows.")

    for pattern, label in BANNED:
        if re.search(pattern, stage_b, flags=re.I):
            problems.append(f"Banned shortcut used: {label}.")

    for block in re.findall(r"```[a-zA-Z]*\n(.*?)```", stage_b, flags=re.S):
        if re.search(r"^\s*(#|//)?\s*\.\.\.\s*$", block, flags=re.M) or "# ..." in block:
            problems.append("A code block contains '...' (shortened code). Every code block must be complete.")
            break

    if "```mermaid" not in stage_b:
        problems.append("No mermaid diagram in Stage B.")

    if len(re.findall(r"<details>", stage_b)) < 6:
        problems.append("Fewer than 6 interview Q&A toggles with full answers.")
    return problems


# ----------------------------------------------------------------------------- OpenAI
def ask_model(client, model: str, messages: list[dict]) -> str:
    """Send messages; automatically reply 'continue' while the model pauses."""
    collected = []
    convo = list(messages)
    for _ in range(MAX_CONTINUES + 1):
        resp = client.chat.completions.create(model=model, messages=convo, max_completion_tokens=32000)
        text = resp.choices[0].message.content or ""
        collected.append(text)
        paused = CONTINUE_MARKER in text[-400:] or resp.choices[0].finish_reason == "length"
        if not paused:
            break
        convo += [{"role": "assistant", "content": text},
                  {"role": "user", "content": "continue — resume exactly where you stopped, same depth, no repetition."}]
    return "\n".join(collected)


def build_part(client, model: str, master: str, part_file: Path) -> tuple[str, list[str], int]:
    transcript = part_file.read_text(encoding="utf-8")
    header = "\n".join(transcript.splitlines()[:2])
    minutes = part_minutes(header)
    code_file = part_file.parent / "code.txt"
    code = code_file.read_text(encoding="utf-8") if code_file.exists() else "none provided — reconstruct only what the transcript states, mark guesses ⚠️"

    user_msg = (f"{header}\nCode for this part:\n```\n{code}\n```\nTranscript:\n```\n{transcript}\n```\n"
                "Follow the master prompt exactly: Stage A coverage map → Stage B detailed notes → Stage C detail audit.")
    messages = [{"role": "system", "content": master}, {"role": "user", "content": user_msg}]

    best_md, best_problems = "", ["not generated"]
    for attempt in range(1, MAX_ATTEMPTS + 1):
        md = ask_model(client, model, messages)
        problems = quality_problems(md, minutes)
        print(f"    attempt {attempt}: {len(problems)} problem(s)")
        if len(problems) < len(best_problems):
            best_md, best_problems = md, problems
        if not problems:
            return md, [], attempt
        feedback = ("Your output FAILED the automatic quality check:\n- " + "\n- ".join(problems) +
                    "\nRewrite the ENTIRE part from Stage A to Stage C, fixing every problem. Do not summarize.")
        messages = messages[:2] + [{"role": "assistant", "content": md}, {"role": "user", "content": feedback}]
    return best_md, best_problems, MAX_ATTEMPTS


# ----------------------------------------------------------------------------- markdown -> Notion blocks
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)")
NOTION_LANGS = {"python", "javascript", "typescript", "bash", "shell", "json", "yaml", "sql", "mermaid",
                "html", "css", "docker", "markdown", "plain text"}


def rich(text: str) -> list[dict]:
    out: list[dict] = []

    def add(content: str, **ann):
        for i in range(0, len(content), 1900):
            item = {"type": "text", "text": {"content": content[i:i + 1900]}}
            link = ann.pop("link", None)
            if link:
                item["text"]["link"] = {"url": link}
            if ann:
                item["annotations"] = ann
            out.append(item)

    for piece in INLINE.split(text):
        if not piece:
            continue
        if piece.startswith("**") and piece.endswith("**"):
            add(piece[2:-2], bold=True)
        elif piece.startswith("`") and piece.endswith("`"):
            add(piece[1:-1], code=True)
        elif piece.startswith("[") and "](" in piece:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", piece).groups()
            add(label, link=url) if url.startswith("http") else add(label)
        elif piece.startswith("*") and piece.endswith("*") and len(piece) > 2:
            add(piece[1:-1], italic=True)
        else:
            add(piece)
    return out[:100] or [{"type": "text", "text": {"content": ""}}]


def blk(kind: str, text: str, **extra) -> dict:
    return {"object": "block", "type": kind, kind: {"rich_text": rich(text), **extra}}


def md_to_blocks(md: str, nested: bool = False) -> list[dict]:
    lines = md.splitlines()
    blocks: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("```"):
            lang = s[3:].strip().lower() or "plain text"
            lang = {"py": "python", "js": "javascript", "ts": "typescript", "sh": "bash", "yml": "yaml",
                    "text": "plain text", "txt": "plain text"}.get(lang, lang)
            code, i = [], i + 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            content = "\n".join(code)
            parts = [{"type": "text", "text": {"content": content[k:k + 1900]}} for k in range(0, max(len(content), 1), 1900)]
            blocks.append({"object": "block", "type": "code",
                           "code": {"rich_text": parts[:100], "language": lang if lang in NOTION_LANGS else "plain text"}})
            i += 1
            continue
        if s.startswith("<details>"):
            summary, body, i = "Details", [], i + 1
            m = re.search(r"<summary>(.*?)</summary>", s)
            if m:
                summary = m.group(1)
            while i < len(lines) and "</details>" not in lines[i]:
                m = re.search(r"<summary>(.*?)</summary>", lines[i])
                if m:
                    summary = m.group(1)
                else:
                    body.append(lines[i])
                i += 1
            i += 1
            children = md_to_blocks("\n".join(body), nested=True)[:100]
            blocks.append({"object": "block", "type": "toggle",
                           "toggle": {"rich_text": rich(re.sub(r"<[^>]+>", "", summary)), "children": children}})
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                    rows.append(cells)
                i += 1
            if nested:  # tables inside toggles would exceed Notion's nesting limit -> plain text
                blocks.append(blk("paragraph", "\n".join(" | ".join(r) for r in rows)))
                continue
            width = max(len(r) for r in rows)
            for start in range(0, len(rows), 99):
                chunk = rows[start:start + 99] if start == 0 else [rows[0]] + rows[start:start + 99]
                blocks.append({"object": "block", "type": "table", "table": {
                    "table_width": width, "has_column_header": True, "has_row_header": False,
                    "children": [{"object": "block", "type": "table_row",
                                  "table_row": {"cells": [rich(c) for c in r + [""] * (width - len(r))]}} for r in chunk]}})
            continue
        if m := re.match(r"^(#{1,6})\s+(.*)", s):
            level = min(len(m.group(1)), 3)
            blocks.append(blk(f"heading_{level}", m.group(2)))
        elif s in ("---", "***"):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
        elif m := re.match(r"^[-*]\s+\[( |x)\]\s+(.*)", s):
            blocks.append(blk("to_do", m.group(2), checked=m.group(1) == "x"))
        elif m := re.match(r"^[-*]\s+(.*)", s):
            blocks.append(blk("bulleted_list_item", m.group(1)))
        elif m := re.match(r"^\d+[.)]\s+(.*)", s):
            blocks.append(blk("numbered_list_item", m.group(1)))
        elif s.startswith(">"):
            blocks.append(blk("quote", s.lstrip("> ")))
        else:
            blocks.append(blk("paragraph", re.sub(r"</?(summary|details)>", "", s)))
        i += 1
    return blocks


# ----------------------------------------------------------------------------- Notion API
class Notion:
    def __init__(self, token: str):
        import requests
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28",
                               "Content-Type": "application/json"})

    def _call(self, method: str, url: str, body: dict) -> dict:
        for attempt in range(6):
            r = self.s.request(method, "https://api.notion.com/v1" + url, json=body, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Notion {r.status_code}: {r.text[:500]}")
            time.sleep(0.35)  # stay under ~3 requests/second
            return r.json()
        raise RuntimeError("Notion API kept failing")

    def create_page(self, parent_id: str, title: str, emoji: str = "📘") -> str:
        body = {"parent": {"page_id": parent_id}, "icon": {"type": "emoji", "emoji": emoji},
                "properties": {"title": {"title": [{"type": "text", "text": {"content": title}}]}}}
        return self._call("POST", "/pages", body)["id"]

    def append(self, page_id: str, blocks: list[dict]) -> None:
        for k in range(0, len(blocks), 90):
            self._call("PATCH", f"/blocks/{page_id}/children", {"children": blocks[k:k + 90]})


# ----------------------------------------------------------------------------- extras
def build_extras(client, model: str, notion: Notion | None, state: dict) -> None:
    revisions = []
    for md_file in sorted(OUT_DIR.glob("*/part-*.md")):
        md = md_file.read_text(encoding="utf-8")
        rev = re.search(r"#+\s*📝.*?(?=\n#+\s|\Z)", md, flags=re.S)
        qa = re.findall(r"<summary>(.*?)</summary>", md)
        revisions.append(f"### {md_file.parent.name} / {md_file.stem}\n{rev.group(0) if rev else ''}\nQuestions: {'; '.join(qa[:10])}")
    digest = "\n\n".join(revisions)[:180000]
    pages = {
        "⚡ Cheat Sheet — LangChain + LangGraph": "Create a one-page cheat sheet of every LangChain/LangGraph class, function and pattern used in the course, grouped by chapter, each with a one-line plain explanation and a minimal code example.",
        "🎯 Mock Interview — 50 Questions with Full Answers": "Create 50 interview questions grouped by chapter, each in a <details><summary> toggle with a full answer (at least 4 sentences) based on the course content, plus how I would relate it to my BankAssist project.",
        "🗓 Study Plan — 1.5 Hours per Day": "Create a day-by-day study plan (1.5 h/day) covering every chapter and part in order, with what to read, what to code, and a checkpoint question per day.",
    }
    for title, task in pages.items():
        md = ask_model(client, model, [{"role": "system", "content": load_master_prompt()},
                                       {"role": "user", "content": f"{task}\nOutput markdown only.\n\nCourse digest:\n{digest}"}])
        (OUT_DIR / f"{title.split(' ', 1)[1]}.md").write_text(md, encoding="utf-8")
        if notion:
            page = notion.create_page(state["hub_id"], title.split(" ", 1)[1], title.split(" ", 1)[0])
            notion.append(page, md_to_blocks(md))
        print(f"  extra page done: {title}")


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="don't write to Notion")
    ap.add_argument("--max-parts", type=int, default=0, help="stop after N new parts (0 = all)")
    ap.add_argument("--extras", action="store_true", help="build cheat sheet / mock interview / study plan")
    args = ap.parse_args()

    from openai import OpenAI
    client = OpenAI()
    model = os.environ.get("OPENAI_MODEL", "gpt-5")
    master = load_master_prompt()
    state = load_state()

    notion = None
    if not args.dry_run:
        token, parent = os.environ.get("NOTION_TOKEN"), os.environ.get("NOTION_PARENT_PAGE_ID")
        if not token or not parent:
            sys.exit("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID, or use --dry-run.")
        notion = Notion(token)
        if not state["hub_id"]:
            state["hub_id"] = notion.create_page(parent, HUB_TITLE, "🤖")
            save_state(state)

    if args.extras:
        build_extras(client, model, notion, state)
        return

    built = 0
    for part_file in list_parts():
        key = f"{part_file.parent.name}/{part_file.stem}"
        if key in state["done"]:
            continue
        print(f"▶ {key}")
        md, problems, attempts = build_part(client, model, master, part_file)

        out_file = OUT_DIR / part_file.parent.name / f"{part_file.stem}.md"
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(md, encoding="utf-8")

        if notion:
            chapter = part_file.parent.name
            if chapter not in state["chapters"]:
                title = re.sub(r"^\d+-", "", chapter).replace("-", " ")
                state["chapters"][chapter] = notion.create_page(state["hub_id"], title, "📗")
            header = part_file.read_text(encoding="utf-8").splitlines()[1]
            notion.append(state["chapters"][chapter], md_to_blocks(f"# {header}\n{md}\n---"))

        state["done"].append(key)
        state["report"][key] = {"attempts": attempts, "remaining_problems": problems}
        save_state(state)
        print(f"  ✅ saved ({'passed' if not problems else 'kept best attempt, ' + str(len(problems)) + ' issue(s) — see state.json'})")
        built += 1
        if args.max_parts and built >= args.max_parts:
            break

    print("Done. Quality report:", STATE_FILE)


if __name__ == "__main__":
    main()
