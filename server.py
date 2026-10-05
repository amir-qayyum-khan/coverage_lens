#!/usr/bin/env python3
"""Shorts Factory ffmpeg render service — Ken Burns stills, concat, captions, ducking."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

APP = FastAPI(title="Shorts Factory Render", version="1.0.0")
app = APP  # uvicorn server:app
FILES = Path("/tmp/shorts-factory-files")
FILES.mkdir(parents=True, exist_ok=True)
SECRET = os.environ.get("RENDER_SECRET", "")
PORT = int(os.environ.get("PORT", "8080"))


class Clip(BaseModel):
    type: str = "still"  # video|still
    url: str
    durationSec: float = 5
    kenBurns: bool = True


class Caption(BaseModel):
    start: float
    end: float
    text: str


class RenderRequest(BaseModel):
    width: int = 1080
    height: int = 1920
    fps: int = 30
    clips: list[Clip] = Field(default_factory=list)
    narrationUrl: str | None = None
    musicUrl: str | None = None
    captions: list[Caption] = Field(default_factory=list)
    musicVolume: float = 0.12


def check_secret(x_render_secret: str | None) -> None:
    if not SECRET:
        return  # open if unset (dev only)
    if not x_render_secret or not hmac.compare_digest(x_render_secret, SECRET):
        raise HTTPException(status_code=401, detail="invalid_render_secret")


def run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd[:6])}...\n{p.stderr[-2000:]}")


def download(url: str, dest: Path) -> None:
    with httpx.Client(timeout=180.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)


def escape_drawtext(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("\n", " ")
    )


@APP.get("/health")
def health() -> dict[str, Any]:
    ff = shutil.which("ffmpeg")
    return {"ok": True, "ffmpeg": bool(ff), "files": str(FILES)}


@APP.get("/files/{file_id}")
def get_file(file_id: str):
    safe = "".join(c for c in file_id if c.isalnum() or c in "._-")
    path = FILES / safe
    if not path.exists():
        raise HTTPException(404, "not_found")
    return FileResponse(path, media_type="video/mp4", filename=safe)


@APP.post("/render")
def render(body: RenderRequest, x_render_secret: str | None = Header(default=None)) -> dict[str, Any]:
    check_secret(x_render_secret)
    if not body.clips:
        raise HTTPException(400, "clips required")
    if len(body.clips) > 40:
        raise HTTPException(400, "too many clips")

    work = Path(tempfile.mkdtemp(prefix="sf_render_"))
    try:
        seg_paths: list[Path] = []
        w, h, fps = body.width, body.height, body.fps
        for i, clip in enumerate(body.clips):
            src = work / f"src_{i}"
            # guess extension from url
            ext = ".mp4" if clip.type == "video" else ".jpg"
            if ".png" in clip.url.lower():
                ext = ".png"
            elif ".webp" in clip.url.lower():
                ext = ".webp"
            elif ".mp4" in clip.url.lower():
                ext = ".mp4"
            src = src.with_suffix(ext)
            download(clip.url, src)
            out = work / f"seg_{i:03d}.mp4"
            dur = max(0.5, float(clip.durationSec))
            if clip.type == "video":
                run([
                    "ffmpeg", "-y", "-i", str(src),
                    "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},setsar=1",
                    "-t", str(dur),
                    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
                    str(out),
                ])
            else:
                # Ken Burns via zoompan
                frames = max(int(dur * fps), 1)
                z = "min(zoom+0.0008,1.12)" if clip.kenBurns else "1"
                vf = (
                    f"scale={w*2}:{h*2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={fps},setsar=1"
                )
                run([
                    "ffmpeg", "-y", "-loop", "1", "-i", str(src),
                    "-vf", vf, "-t", str(dur),
                    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
                    str(out),
                ])
            seg_paths.append(out)

        # concat
        lst = work / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in seg_paths))
        silent = work / "silent.mp4"
        run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c", "copy", str(silent),
        ])

        # audio
        audio_inputs: list[str] = []
        filter_parts: list[str] = []
        narr = work / "narr.mp3"
        music = work / "music.mp3"
        aidx = 0
        if body.narrationUrl:
            download(body.narrationUrl, narr)
            audio_inputs += ["-i", str(narr)]
            filter_parts.append(f"[{aidx}:a]volume=1.0[a{aidx}]")
            aidx += 1
        if body.musicUrl:
            download(body.musicUrl, music)
            audio_inputs += ["-i", str(music)]
            filter_parts.append(f"[{aidx}:a]volume={body.musicVolume}[a{aidx}]")
            aidx += 1

        mixed = work / "with_audio.mp4"
        if aidx == 0:
            # generate silent audio track matching length
            run([
                "ffmpeg", "-y", "-i", str(silent),
                "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-shortest", "-c:v", "copy", "-c:a", "aac", str(mixed),
            ])
        elif aidx == 1:
            run([
                "ffmpeg", "-y", "-i", str(silent), *audio_inputs,
                "-filter_complex", filter_parts[0] + f";[a0]aformat=sample_rates=44100:channel_layouts=stereo[aout]",
                "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", str(mixed),
            ])
        else:
            fc = ";".join(filter_parts) + ";[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]"
            run([
                "ffmpeg", "-y", "-i", str(silent), *audio_inputs,
                "-filter_complex", fc,
                "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", str(mixed),
            ])

        # burn captions
        final = work / "final.mp4"
        if body.captions:
            # build ASS file
            ass = work / "subs.ass"
            header = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".format(w=w, h=h)

            def ts(sec: float) -> str:
                h_ = int(sec // 3600)
                m_ = int((sec % 3600) // 60)
                s_ = sec % 60
                return f"{h_}:{m_:02d}:{s_:05.2f}"

            events = []
            for c in body.captions:
                text = escape_drawtext(c.text).replace("\\'", "'")
                events.append(f"Dialogue: 0,{ts(c.start)},{ts(c.end)},Default,,0,0,0,,{text}")
            ass.write_text(header + "\n".join(events) + "\n")
            run([
                "ffmpeg", "-y", "-i", str(mixed), "-vf", f"ass={ass}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-c:a", "copy",
                str(final),
            ])
        else:
            shutil.copy(mixed, final)

        file_id = f"{uuid.uuid4().hex}.mp4"
        dest = FILES / file_id
        shutil.copy(final, dest)
        # probe duration
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dest)],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip() or 0)
        return {
            "ok": True,
            "fileId": file_id,
            "mp4UrlPath": f"/files/{file_id}",
            "bytes": dest.stat().st_size,
            "durationSec": duration,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(APP, host="0.0.0.0", port=PORT)
