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


def bare(token):
    word = re.sub(r"^[\"'(\[]+|[.,!?;:\"')\]]+$", "", token.lower())
    return word if WORD.match(word) and len(word) <= 24 else None


def prompts(config_dir):
    seen = set()
    for path in glob.glob(os.path.join(config_dir, "projects", "**", "*.jsonl"), recursive=True):
        with open(path, errors="ignore") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("type") != "user" or row.get("isMeta") or row.get("isSidechain"):
                    continue
                content = row.get("message", {}).get("content")
                if isinstance(content, list):
                    content = "\n".join(b.get("text", "") for b in content if b.get("type") == "text")
                if not isinstance(content, str):
                    continue
                text = content.strip()
                if not text or text.startswith(("<", "[Request interrupted", "Caveat:")) or text in seen:
                    continue
                seen.add(text)
                yield text


def pack(counts, keep):
    rows = []
    for key, nexts in counts.items():
        top = [word for word, n in nexts.most_common(keep) if n >= MINIMUM]
        if top:
            rows.append(key + ":" + ",".join(top))
    return "|".join(rows)


def main():
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    after_one = defaultdict(Counter)
    after_two = defaultdict(Counter)
    count = 0
    for text in prompts(config_dir):
        count += 1
        prose = re.sub(r"`[^`]*`", " ", re.sub(r"```[\s\S]*?```", "\n", text))
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", prose):
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
                before = [] if re.search(r"[.!?,;:]$", token) else (before + [word])[-2:]

    print(json.dumps({"prompts": count, "next": pack(after_one, NEXT_PER_WORD), "next2": pack(after_two, NEXT_PER_PAIR)}))


if __name__ == "__main__":
    main()
