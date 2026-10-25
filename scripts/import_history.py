"""Counts word sequences in the prompts you typed in past Claude Code sessions.

Run by `/predict import`. Reads <config dir>/projects/**/*.jsonl (the config
dir is $CLAUDE_CONFIG_DIR, else ~/.claude), keeps only what a person typed (no
tool results, subagent prompts, system notes or slash-command wrappers), and
prints, as JSON on stdout, which words most often follow one word and two
words. Nothing is written or sent anywhere.

usage: python3 -I import_history.py
"""
import glob
import json
import os
import re
from collections import Counter, defaultdict

WORD = re.compile(r"^[a-z][a-z']*$")
START = "<s>"
NEXT_PER_WORD = 6
NEXT_PER_PAIR = 4
MINIMUM = 2
# Characters per table, so the result fits the plugin's store beside the word list.
BUDGET = 600_000
SKIPPED = ("<", "[Request interrupted", "Caveat:")


def bare(token):
    word = re.sub(r"^[\"'(\[]+|[.,!?;:\"')\]]+$", "", token.lower())
    return word if WORD.match(word) and len(word) <= 24 else None


def typed_text(row):
    """What the person typed in a transcript row, or None for anything else."""
    if row.get("type") != "user" or row.get("isMeta") or row.get("isSidechain"):
        return None
    # Compaction summaries are Claude's words, stored as user rows.
    if row.get("isCompactSummary") or row.get("isVisibleInTranscriptOnly"):
        return None
    content = (row.get("message") or {}).get("content")
    blocks = [content] if isinstance(content, str) else [
        b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text"
    ]
    # Tags (<system-reminder>, <command-name>, ...) and notices are added by the app, block by block.
    kept = [b.strip() for b in blocks if isinstance(b, str) and not b.lstrip().startswith(SKIPPED)]
    text = "\n".join(b for b in kept if b)
    return text or None


def prompts(config_dir):
    seen = set()
    for path in glob.glob(os.path.join(config_dir, "projects", "**", "*.jsonl"), recursive=True):
        if f"{os.sep}subagents{os.sep}" in path:
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"type":"user"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                text = typed_text(row)
                # A resumed or forked session copies earlier rows: count each row once.
                key = row.get("uuid") or text
                if text and key not in seen:
                    seen.add(key)
                    yield text


def pack(counts, keep, budget):
    """`key:a,b|...` for the most used keys first, up to `budget` characters."""
    rows = []
    size = 0
    for key, nexts in sorted(counts.items(), key=lambda kv: -sum(kv[1].values())):
        top = [word for word, n in nexts.most_common(keep) if n >= MINIMUM]
        if not top:
            continue
        row = key + ":" + ",".join(top)
        if size + len(row) + 1 > budget:
            break
        rows.append(row)
        size += len(row) + 1
    return "|".join(rows)


def main():
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    after_one = defaultdict(Counter)
    after_two = defaultdict(Counter)
    count = 0
    for text in prompts(config_dir):
        count += 1
        # As hooks/predict.ts `learn` does: closed fences, an unclosed one, inline code.
        prose = re.sub(r"(```|~~~)[\s\S]*?\1", "\n", text)
        prose = re.sub(r"(```|~~~)[\s\S]*$", "\n", prose)
        prose = re.sub(r"`[^`\n]*`", " ", prose)
        for sentence in re.split(r"(?<=[.!?])\s+|(?<=[.!?][\"')])\s+|\n+", prose):
            before = [START]
            for token in sentence.split():
                word = bare(token)
                if not word:
                    before = []
                    continue
                if before:
                    after_one[before[-1]][word] += 1
                if len(before) >= 2:
                    after_two[before[-2] + " " + before[-1]][word] += 1
                before = [] if re.search(r"[.!?,;:][\"')]*$", token) else (before + [word])[-2:]

    print(json.dumps({
        "prompts": count,
        "next": pack(after_one, NEXT_PER_WORD, BUDGET),
        "next2": pack(after_two, NEXT_PER_PAIR, BUDGET),
    }))


if __name__ == "__main__":
    main()
