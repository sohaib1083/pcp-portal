"""Voice the film narration with Microsoft neural TTS (edge-tts): one clip per sentence.

Reads  $FILM_OUT/narration.json  (from `node e2e/film/film.mjs --export`)
Writes $FILM_OUT/clips/NNN.mp3 and $FILM_OUT/clips/durations.json
Env:   VOICE (default en-GB-RyanNeural), RATE (default -3%)
"""
import asyncio, json, os, re, subprocess, sys
from pathlib import Path

import edge_tts

OUT = Path(os.environ.get("FILM_OUT", Path(__file__).parent / "out"))
VOICE = os.environ.get("VOICE", "en-GB-RyanNeural")
RATE = os.environ.get("RATE", "-3%")

# Captions keep the written form; the voice gets letter-by-letter acronyms.
SAY_AS = {
    r"\bNOCs?\b": lambda m: "N.O.C." + ("s" if m.group(0).endswith("s") else ""),
    r"\bCNIC\b": lambda m: "C.N.I.C.",
    r"\bPSID\b": lambda m: "P.S.I.D.",
    r"\bHEC\b": lambda m: "H.E.C.",
    r"\bPCP\b": lambda m: "P.C.P.",
    r"\bQR\b": lambda m: "Q.R.",
}


def spoken(text: str) -> str:
    for pat, rep in SAY_AS.items():
        text = re.sub(pat, rep, text)
    return text.replace(". .", ".").replace("..", ".")


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


async def main():
    lines = json.loads((OUT / "narration.json").read_text())
    clips = OUT / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    result = []
    for line in lines:
        f = clips / f"{line['id']:03d}.mp3"
        meta = clips / f"{line['id']:03d}.txt"
        voice_text = spoken(line["text"])
        key = f"{VOICE}|{RATE}|{voice_text}"
        if not (f.exists() and meta.exists() and meta.read_text() == key):
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(voice_text, VOICE, rate=RATE).save(str(f))
                    break
                except Exception as e:  # network hiccups
                    if attempt == 3:
                        raise
                    print("retry", line["id"], e, file=sys.stderr)
                    await asyncio.sleep(2)
            meta.write_text(key)
        d = duration(f)
        result.append({"id": line["id"], "text": line["text"], "file": f.name, "dur": round(d, 3)})
        print(f"{line['id']:03d} {d:5.2f}s  {line['text'][:70]}")
    (clips / "durations.json").write_text(json.dumps(result, indent=1))
    print(f"total narration {sum(r['dur'] for r in result):.1f}s in {len(result)} clips")


asyncio.run(main())
