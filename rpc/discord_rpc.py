import warnings
warnings.simplefilter("ignore", RuntimeWarning)
warnings.simplefilter("ignore", ResourceWarning)

import time
import threading
import subprocess
import sys
import json
import requests
from pathlib import Path
from typing import Optional

FALLBACK_IMAGE_KEY = "alora_logo"
MIN_TRACK_SWITCH_INTERVAL = 5


def fetch_apple_artwork(artist: str, title: str) -> Optional[str]:
    if not artist or not title:
        return None
    try:
        params = {"term": f"{artist} {title}", "entity": "song", "limit": 1}
        r = requests.get("https://itunes.apple.com/search", params=params, timeout=4)
        r.raise_for_status()
        data = r.json()
        if data.get("resultCount", 0) > 0:
            artwork = data["results"][0].get("artworkUrl100")
            if artwork:
                return artwork.replace("100x100", "600x600")
    except Exception:
        pass
    return None


class AloraRPC:
    def __init__(self, client_id: str):
        self.client_id = client_id
        self._process: Optional[subprocess.Popen] = None
        self._started = False
        self._lock = threading.Lock()
        self._loading: set = set()
        self._loading_lock = threading.Lock()
        self._current_task: dict = {}
        self._last_seek_update = 0.0
        self._last_switch = 0

    def _get_python_exe(self) -> str:
        import shutil
        exe = sys.executable
        if 'python' in exe.lower():
            return exe
        return shutil.which('python') or exe

    def _start_helper(self):
        with self._lock:
            if self._started:
                return
            self._started = True
        try:
            helper_path = Path(__file__).parent / "discord_rpc_helper.py"
            python_exe = self._get_python_exe()
            self._process = subprocess.Popen(
                [python_exe, str(helper_path), self.client_id],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
            time.sleep(0.5)
        except Exception as e:
            print(f"[RPC] Helper start error: {e}")
            self._started = False

    def _send(self, cmd: str, data: dict = None):
        if not self._process or self._process.poll() is not None:
            return
        try:
            msg = json.dumps({"cmd": cmd, "data": data or {}}) + "\n"
            self._process.stdin.write(msg.encode('utf-8'))
            self._process.stdin.flush()
        except Exception:
            self._process = None

def _send_rpc(self, title: str, artist: str, album: str,
              start_ts: Optional[int], image: str, end_ts: Optional[int] = None,
              elapsed_ms: int = 0, duration_ms: int = 0):
        elapsed_sec = elapsed_ms // 1000
        duration_sec = duration_ms // 1000
        elapsed_str = f"{elapsed_sec//60}:{elapsed_sec%60:02d}"
        duration_str = f"{duration_sec//60}:{duration_sec%60:02d}"
        
        data = {
            "details": title or "Unknown Track",
            "state": f"{elapsed_str} / {duration_str} • {artist or 'Unknown Artist'}",
            "large_image": FALLBACK_IMAGE_KEY,
            "small_image": "alora_logo",
            "small_text": "Alora Player",
            "activity_type": 2,
        }
        if self._current_task:
            if self._current_task.get("large_image"):
                data["large_image"] = self._current_task["large_image"]
            if self._current_task.get("start_ts") is not None:
                data["start"] = self._current_task["start_ts"]
            if self._current_task.get("duration_ms"):
                data["end"] = self._current_task["start_ts"] + (self._current_task["duration_ms"] // 1000)
        else:
            if start_ts is not None:
                data["start"] = start_ts
            if end_ts is not None:
                data["end"] = end_ts
        if data["large_image"] == FALLBACK_IMAGE_KEY and image and image != FALLBACK_IMAGE_KEY:
            data["large_image"] = image
        self._send("update", data)

    def update(self, title: str, artist: str, album: str = "",
             elapsed_ms: int = 0, duration_ms: int = 0, **kwargs):
        now = time.time()
        if now - self._last_switch < MIN_TRACK_SWITCH_INTERVAL:
            return
        self._last_switch = now

        self._start_helper()
        start_ts = int(time.time()) - elapsed_ms // 1000
        end_ts = start_ts + duration_ms // 1000 if duration_ms else None

        self._current_task = {
            "title": title,
            "artist": artist,
            "album": album,
            "start_ts": start_ts,
            "duration_ms": duration_ms,
        }

        self._send_rpc(title, artist, album, start_ts, FALLBACK_IMAGE_KEY, end_ts, elapsed_ms, duration_ms)

        cache_key = f"{artist.lower().strip()}||{title.lower().strip()}"
        with self._loading_lock:
            if cache_key in self._loading:
                return
            self._loading.add(cache_key)

        threading.Thread(
            target=self._load_artwork,
            args=(title, artist, album, start_ts, cache_key),
            daemon=True,
            name="rpc-artwork",
        ).start()

    def pause(self, elapsed_ms: int = 0):
        self._start_helper()
        self._send("clear")

    def resume(self, elapsed_ms: int = 0, duration_ms: int = 0):
        if not self._current_task:
            return
        self._start_helper()
        t = self._current_task
        start_ts = int(time.time()) - elapsed_ms // 1000
        end_ts = start_ts + duration_ms // 1000 if duration_ms else None
        t["start_ts"] = start_ts
        t["duration_ms"] = duration_ms
        self._send_rpc(t["title"], t["artist"], t["album"],
                       start_ts, t.get("large_image", FALLBACK_IMAGE_KEY), end_ts, elapsed_ms, duration_ms)

    def seek(self, elapsed_ms: int = 0, duration_ms: int = 0):
        if not self._current_task:
            return
        self._start_helper()
        t = self._current_task
        start_ts = int(time.time()) - elapsed_ms // 1000
        end_ts = start_ts + duration_ms // 1000 if duration_ms else None
        t["start_ts"] = start_ts
        t["duration_ms"] = duration_ms
        self._send_rpc(t["title"], t["artist"], t["album"],
                       start_ts, t.get("large_image", FALLBACK_IMAGE_KEY), end_ts, elapsed_ms, duration_ms)

    def clear(self):
        self._start_helper()
        self._current_task = {}
        self._send("clear")

    def disconnect(self):
        self._current_task = {}
        try:
            self._send("disconnect")
            if self._process:
                self._process.terminate()
                self._process.wait(timeout=2)
        except Exception:
            try:
                if self._process:
                    self._process.kill()
            except Exception:
                pass
        self._process = None

    def _load_artwork(self, title, artist, album, start_ts, cache_key):
        try:
            url = fetch_apple_artwork(artist, title)
            if url:
                self._current_task["large_image"] = url
                start_ts = self._current_task.get("start_ts", int(time.time()))
                duration_ms = self._current_task.get("duration_ms", 0)
                self._send_rpc(title, artist, album, start_ts, url, None, 0, duration_ms)
        except Exception:
            pass
        finally:
            with self._loading_lock:
                self._loading.discard(cache_key)