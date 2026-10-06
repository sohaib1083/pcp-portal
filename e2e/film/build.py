"""Assemble the film: screencast frames + narration clips placed at their recorded times.

Reads  $FILM_OUT/frames.json, timeline.json, clips/
Writes $FILM_OUT/pcp-walkthrough.mp4, captions.vtt, transcript.json, poster.jpg
Env:   CRF (default 24)
"""
import array, json, os, subprocess, wave
from pathlib import Path

OUT = Path(os.environ.get("FILM_OUT", Path(__file__).parent / "out"))
CRF = os.environ.get("CRF", "24")
SR = 24000

fr = json.loads((OUT / "frames.json").read_text())
tl = json.loads((OUT / "timeline.json").read_text())
clips = json.loads((OUT / "clips" / "durations.json").read_text())
T0, frames, end = fr["T0"], fr["frames"], tl["end"]

# 1. Video: variable-duration frames via the concat demuxer
lines = []
for i, f in enumerate(frames):
    t = f["t"] - T0
    nxt = (frames[i + 1]["t"] - T0) if i + 1 < len(frames) else end
    lines.append(f"file '{OUT / 'frames' / f['file']}'\nduration {max(nxt - t, 0.001):.4f}")
lines.append(f"file '{OUT / 'frames' / frames[-1]['file']}'")
(OUT / "frames.txt").write_text("\n".join(lines) + "\n")

# 2. Audio: each sentence's clip mixed in at the moment its caption appeared
mix = array.array("i", bytes(4 * (int(end * SR) + SR)))
for s in tl["sentences"]:
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(OUT / "clips" / clips[s["id"]]["file"]), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    a = array.array("h", pcm)
    off = int(s["start"] * SR)
    for j, v in enumerate(a):
        if off + j < len(mix):
            mix[off + j] += v
out = array.array("h", (max(-32768, min(32767, v)) for v in mix))
with wave.open(str(OUT / "narration.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())

# 3. Encode
mp4 = OUT / "pcp-walkthrough.mp4"
subprocess.run(
    ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(OUT / "frames.txt"), "-i", str(OUT / "narration.wav"),
     "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", CRF,
     # Voice at streaming loudness (-14 LUFS), stereo, so it is clearly audible on laptop speakers
     "-af", "loudnorm=I=-14:TP=-1:LRA=9,aresample=48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k",
     "-t", f"{end:.2f}", "-movflags", "+faststart", str(mp4)],
    check=True,
)

# 4. Captions (WebVTT) and a transcript with chapters for the web page
def ts(x):
    h, r = divmod(x, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"

vtt = ["WEBVTT", ""]
for i, c in enumerate(tl["captions"], 1):
    vtt += [str(i), f"{ts(c['start'])} --> {ts(c['end'])}", c["text"], ""]
(OUT / "captions.vtt").write_text("\n".join(vtt))
(OUT / "transcript.json").write_text(json.dumps({
    "duration": round(end, 2),
    "ref": tl.get("ref"),
    "cert": tl.get("cert"),
    "chapters": [{"title": c["title"], "start": round(c["start"], 2)} for c in tl["chapters"]],
    "sentences": [{"start": round(s["start"], 2), "end": round(s["start"] + s["dur"], 2), "text": s["text"]} for s in tl["sentences"]],
}, indent=1))

poster_t = next((s["start"] + 1.5 for s in tl["sentences"] if s["text"].startswith("The automatic checks")), 5)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{poster_t:.2f}", "-i", str(mp4), "-frames:v", "1", "-q:v", "3", str(OUT / "poster.jpg")], check=True)
size = mp4.stat().st_size / 1e6
print(f"{mp4} · {end / 60:.1f} min · {size:.1f} MB · {len(tl['captions'])} captions · {len(tl['chapters'])} chapters")
