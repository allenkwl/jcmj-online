#!/usr/bin/env python3
"""BGM 的共用工具：寫多軌 MIDI（拍為單位）＋ 用 GarageBand 的取樣演奏成 MP3（tools/exs_render.py）。

2026-10-16：使用者決定所有 BGM 改成 MIDI、一首一首升級（擇國而立 → 主畫面 → 對局 → 聽牌 → 七國 → 敗亡）。
每一首是一支 tools/build-<名>-bgm-midi.py，只寫音樂；這裡處理檔案格式、試聽、循環、音量一致。

用法（每一首）：
    song = Song("title", bpm=64, bars=16, key_sig=(1, 0))      # 一輪 16 小節
    gz = song.track("古箏", program=107)                         # program 只給 GarageBand 匯入時對樂器用
    for L in song.loops(): gz.note(song.at(L, 1, 0), 1, 62, 80)  # 第 L 輪、第 1 小節、第 0 拍
    song.main(instruments)                                      # 處理命令列：--stems 量各軌響度、--render 出試聽、--game 出遊戲用的循環

產出：assets/audio/<名>-bgm.mid（兩輪：試聽與遊戲版都從這份來）
  --render  試聽版 assets/audio/試聽/<名>.mp3：兩輪接起來，聽得到接縫；最後 1.4 秒淡出（不進 git）
  --game    遊戲版 assets/audio/bgm/<場景>.mp3 ＋ 更新 assets/audio/bgm/manifest.js（src/audio.js 照這份播）

── 遊戲版怎麼做到無縫循環 ──
  取兩輪裡的第二輪（開頭帶著第一輪的殘響尾巴），前後各多接 PAD 秒：[一輪的最後 PAD 秒][一輪][一輪的最前 PAD 秒]。
  播放時只在 [PAD, PAD＋一輪) 裡繞圈。MP3 解碼開頭會多出幾十毫秒的延遲（各瀏覽器不一樣，有的會自動去掉、有的不會），
  因為前後補的是「循環本身的內容」，整段平移幾十毫秒仍然是同一個圓圈的一段 —— 不管延遲多少都接得起來。
"""
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "assets" / "audio"
TPQ = 480

# 音名 → MIDI（C4 = 60）
_NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(name):
    """'A4' → 69，'F#3' → 54，'Bb2' → 46"""
    base = _NAMES[name[0]]
    i = 1
    if name[i:i + 1] == "#":
        base += 1; i += 1
    elif name[i:i + 1] == "b":
        base -= 1; i += 1
    return 12 * (int(name[i:]) + 1) + base


def _vlq(v):
    v = max(0, int(v))
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    return bytes(reversed(out))


def _meta(kind, payload):
    return bytes([0xFF, kind]) + _vlq(len(payload)) + payload


class Track:
    def __init__(self, song, name, channel, program=None, volume=100, pan=64):
        self.song, self.name, self.channel = song, name, channel
        self.events = []
        self._add(0, 0, _meta(0x03, name.encode("utf-8")))
        if channel is not None:
            if program is not None:
                self._add(0, 1, bytes([0xC0 | channel, program]))
            self._add(0, 1, bytes([0xB0 | channel, 7, volume]))
            self._add(0, 1, bytes([0xB0 | channel, 10, pan]))

    def _add(self, beats, order, data):
        self.events.append((round(beats * TPQ), order, data))

    def note(self, beats, dur, pitch, vel):
        """beats：從頭算起第幾拍；dur：幾拍"""
        if isinstance(pitch, str):
            pitch = n(pitch)
        self._add(beats, 3, bytes([0x90 | self.channel, pitch, max(1, min(127, int(vel)))]))
        self._add(beats + dur, 2, bytes([0x80 | self.channel, pitch, 0]))

    def chord(self, beats, dur, pitches, vel):
        for p in pitches:
            self.note(beats, dur, p, vel)

    def marker(self, beats, text):
        self._add(beats, 0, _meta(0x06, text.encode("utf-8")))

    def _chunk(self, total_beats):
        self._add(total_beats, 9, _meta(0x2F, b""))
        data, last = bytearray(), 0
        for at, _, ev in sorted(self.events, key=lambda e: (e[0], e[1])):
            data += _vlq(at - last) + ev
            last = at
        return b"MTrk" + struct.pack(">I", len(data)) + data


class Song:
    def __init__(self, name, bpm, bars, beats_per_bar=4, key_sig=(0, 0), loops=2, scene=None):
        self.name, self.bpm, self.bars, self.bpb = name, bpm, bars, beats_per_bar
        self.scene = scene or name                      # 遊戲裡的場景名（BGM.play 用）：七國是 qi、chu…
        self.loop_count = next((int(a) for a in sys.argv[1:] if a.isdigit()), loops)
        self.beat = 60 / bpm
        self.loop_beats = bars * beats_per_bar
        self.loop_seconds = self.loop_beats * self.beat
        self.conductor = Track(self, f"{name}－導演軌", None)
        self.conductor._add(0, 0, _meta(0x51, round(60_000_000 / bpm).to_bytes(3, "big")))
        self.conductor._add(0, 0, _meta(0x58, bytes([beats_per_bar, 2, 24, 8])))
        sf, mi = key_sig
        self.conductor._add(0, 0, _meta(0x59, bytes([sf & 0xFF, mi])))
        self.tracks = [self.conductor]
        self._ch = 0
        self.mid = AUDIO / f"{name}-bgm.mid"
        self.mp3 = AUDIO / "試聽" / f"{name}.mp3"

    def track(self, name, program=None, drums=False, volume=100, pan=64):
        if drums:
            ch = 9
        else:
            ch = self._ch
            self._ch += 1
            if self._ch == 9:
                self._ch = 10
        t = Track(self, name, ch, program, volume, pan)
        self.tracks.append(t)
        return t

    def loops(self):
        for L in range(self.loop_count):
            self.conductor.marker(self.at(L, 1), f"第 {L + 1} 輪")
            yield L

    def at(self, loop, bar, beat=0.0):
        """第 loop 輪（0 起）、第 bar 小節（1 起）、第 beat 拍（0 起）→ 從頭算起第幾拍"""
        return loop * self.loop_beats + (bar - 1) * self.bpb + beat

    @property
    def seconds(self):
        return self.loop_count * self.loop_seconds

    def write(self):
        total = self.loop_count * self.loop_beats
        chunks = [t._chunk(total) for t in self.tracks]
        self.mid.parent.mkdir(parents=True, exist_ok=True)
        self.mid.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ) + b"".join(chunks))
        print(self.mid, f"{self.loop_count} 輪，{self.seconds:.2f} 秒（一輪 {self.loop_seconds:.2f} 秒）")

    def main(self, instruments):
        """instruments：無參數函式，回 {軌名: Inst}（延遲建立，只寫 MIDI 時不用載取樣）"""
        self.write()
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from exs_render import render, to_mp3, stem_loudness
        if "--stems" in sys.argv:
            for k, v in stem_loudness(self.mid, instruments(), seconds=self.loop_seconds).items():
                print(f"  {k:24s} {v:6.1f} LUFS")
        if "--render" in sys.argv:
            self.mp3.parent.mkdir(parents=True, exist_ok=True)
            wav = self.mp3.with_suffix(".wav")
            render(self.mid, instruments(), wav, total_seconds=self.seconds + 1.5)
            to_mp3(wav, self.mp3, fade=(self.seconds, 1.4))
            wav.unlink()
            print(self.mp3)
        if "--game" in sys.argv:
            assert self.loop_count >= 2, "--game 要至少兩輪（取第二輪，殘響尾巴才接得回開頭）"
            import numpy as np
            import soundfile as sf
            out = GAME_DIR / f"{self.scene}.mp3"
            out.parent.mkdir(parents=True, exist_ok=True)
            wav = out.with_suffix(".wav")
            render(self.mid, instruments(), wav, loop_seconds=self.loop_seconds)
            x, sr = sf.read(str(wav), dtype="float32")
            p = int(PAD * sr)
            sf.write(str(wav), np.concatenate([x[-p:], x, x[:p]]), sr, subtype="PCM_24")
            to_mp3(wav, out, quality=4)
            wav.unlink()
            update_manifest(self.scene, f"{self.scene}.mp3", self.loop_seconds)
            print(out, f"（遊戲用：一輪 {self.loop_seconds:.3f} 秒＋前後各 {PAD} 秒）")


GAME_DIR = AUDIO / "bgm"
PAD = 0.5
MANIFEST = GAME_DIR / "manifest.js"


def update_manifest(scene, file, loop_seconds):
    """assets/audio/bgm/manifest.js：用 <script> 載（雙擊開 file:// 時 fetch 讀不了 JSON，跟 assets/manifest.js 同一招）"""
    data = {}
    if MANIFEST.exists():
        t = MANIFEST.read_text(encoding="utf-8")
        data = json.loads(t[t.index("{"):t.rindex("}") + 1])
    data[scene] = {"src": f"assets/audio/bgm/{file}", "loopStart": PAD, "loopEnd": round(PAD + loop_seconds, 4)}
    MANIFEST.write_text(
        "/* 由 tools/bgm_midi.py（--game）產生，不要手改。\n"
        "   每一首：src 檔案、loopStart／loopEnd 循環段（秒）—— 檔案前後各多接一小段循環本身的內容，見 bgm_midi.py 的說明 */\n"
        "window.MJ_BGM = " + json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8")
