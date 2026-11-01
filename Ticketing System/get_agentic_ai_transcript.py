"""Download the transcript of the freeCodeCamp Agentic AI course and split it into
~20-minute parts per chapter, ready to paste into ChatGPT.

Setup (once):
    python3 -m venv .venv && source .venv/bin/activate
    pip install youtube-transcript-api
Run:
    python get_agentic_ai_transcript.py
Output: ./agentic_ai_transcript/<NN>-<chapter>/part-<N>.txt
"""
from pathlib import Path
import re

from youtube_transcript_api import YouTubeTranscriptApi

VIDEO_ID = "Zy7EXDONlTY"
PART_MINUTES = 20

CHAPTERS = [
    ("00:00:00", "Introduction & Planning"),
    ("00:08:33", "Evolution from LLMs to Agentic AI"),
    ("00:41:26", "Agentic AI Core Characteristics & Components"),
    ("01:33:18", "Asynchronous Programming for AI Agents"),
    ("02:06:23", "Pydantic for AI Agents"),
    ("03:27:08", "Single AI Agent System with LangChain"),
    ("04:49:37", "Multi-Agent AI System with LangChain"),
    ("06:30:27", "What is LangGraph and Why"),
    ("07:44:43", "LangGraph Core Components"),
    ("08:29:07", "Sequential Workflows in LangGraph"),
    ("09:19:04", "Parallel Workflows in LangGraph"),
    ("10:15:27", "Conditional Workflows in LangGraph"),
    ("11:06:05", "Iterative Workflows in LangGraph"),
    ("11:35:51", "First Agentic Chatbot with LangGraph"),
    ("12:43:49", "Why Persistence is Required"),
    ("13:51:00", "Streaming Responses"),
    ("14:10:02", "Chat Threading"),
    ("14:42:02", "Permanent Persistence Memory with Database"),
    ("15:16:31", "Monitoring with LangSmith"),
    ("15:40:24", "Tools in Agentic Chatbot"),
    ("16:54:17", "RAG in Agentic Chatbot"),
    ("17:50:27", "Human-in-the-Loop"),
    ("18:48:09", "CI-CD Deployment on AWS"),
    ("19:52:05", "Deploy on Render"),
    ("20:06:27", "Project - Your Own ChatGPT Agent"),
    ("22:21:17", "Project - TripMate AI Multi-Agent Travel Planner"),
]


def to_seconds(hms: str) -> int:
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def stamp(sec: float) -> str:
    sec = int(sec)
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def main() -> None:
    segments = list(YouTubeTranscriptApi().fetch(VIDEO_ID, languages=["en"]))
    out = Path("agentic_ai_transcript")
    starts = [to_seconds(t) for t, _ in CHAPTERS] + [10**9]

    for i, (start, title) in enumerate(CHAPTERS):
        chap_start, chap_end = starts[i], starts[i + 1]
        chap = [s for s in segments if chap_start <= s.start < chap_end]
        folder = out / f"{i:02d}-{re.sub(r'[^A-Za-z0-9]+', '-', title).strip('-')}"
        folder.mkdir(parents=True, exist_ok=True)

        part, part_start = 1, chap_start
        while part_start < (chap[-1].start if chap else chap_start):
            part_end = part_start + PART_MINUTES * 60
            lines = [f"[{stamp(s.start)}] {s.text}" for s in chap if part_start <= s.start < part_end]
            if lines:
                header = f"Chapter: {title}\nPart: {part} ({stamp(part_start)}-{stamp(min(part_end, chap_end))})\n\n"
                (folder / f"part-{part}.txt").write_text(header + "\n".join(lines), encoding="utf-8")
                part += 1
            part_start = part_end
        print(f"{folder.name}: {part - 1} part(s)")


if __name__ == "__main__":
    main()
