#!/usr/bin/env python3
"""建立「天下一統」慶祝動畫的 24 秒配樂（Type 1 多軌 MIDI），格式照 build-intro-bgm-midi.py。

    python3 tools/build-unify-bgm-midi.py

產出：
  ‧ assets/audio/unify-bgm.mid       ← 匯入 GarageBand，每一軌換成喜歡的軟體樂器，轉成 MP3
  ‧ assets/audio/unify-bgm.notes.js  ← 同一份音符。GarageBand 的 MP3 還沒做好之前，
                                        預覽頁（devtools/統一天下動畫）用瀏覽器合成來放，先對時間點
轉好的 MP3 放成 assets/audio/unify-bgm.mp3，src/unify.js 會自動改用它。

分軌（匯入後可以直接對應）：
  1. 古箏／撥弦　2. 戰鼓　3. 編鐘　4. 號角銅管　5. 弦樂長音　6. 低音　7. 定音鼓　8. 銅鑼

時間軸跟動畫共用（src/unify.js 的 SCENES）——改這裡的秒數，那邊也要跟著改：
  0.0– 4.0  天下歸一：本國＋六國一國一國染上主公的顏色（七記戰鼓＋編鐘）
  4.0– 7.5  天下一統：大字砸下（銅鑼＋定音鼓），主公出征三格，號角主題
  7.5–13.0  詔書：「奉天承運……」，主公平靜下來（弦樂＋古箏旋律）
 13.0–18.0  六國來朝：被征服的六國君主一位一位出現（每位一聲編鐘）
 18.0–24.0  慶功：金光煙火、「恭喜主公」，全體齊奏，22 秒定音，24 秒淡出

調性：D 大調五聲（D E F# A B），比開場的 D 小調亮 —— 開場是亂世，這裡是凱旋。
"""
from pathlib import Path
import json
import struct

BPM = 120
TPQ = 480
DURATION = 24.0
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio" / "unify-bgm.mid"
OUT_JS = ROOT / "assets" / "audio" / "unify-bgm.notes.js"


def tick(seconds):
    return round(seconds * BPM / 60 * TPQ)


def vlq(value):
    value = max(0, int(value))
    out = [value & 0x7f]
    value >>= 7
    while value:
        out.append((value & 0x7f) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def meta(kind, payload):
    return bytes([0xff, kind]) + vlq(len(payload)) + payload


NOTES = []   # 給瀏覽器合成用：[起, 長, 音高, 力度, 軌名]


class Track:
    def __init__(self, name, key, channel=None, program=None, volume=100, pan=64):
        self.key = key
        self.events = []
        self.add(0, 0, meta(0x03, name.encode("utf-8")))
        if channel is not None:
            if program is not None:
                self.add(0, 1, bytes([0xc0 | channel, program]))
            self.add(0, 1, bytes([0xb0 | channel, 7, volume]))
            self.add(0, 1, bytes([0xb0 | channel, 10, pan]))
            self.add(0, 1, bytes([0xb0 | channel, 91, 40]))   # reverb
            self.add(0, 1, bytes([0xb0 | channel, 93, 10]))   # chorus
        self.channel = channel

    def add(self, at, order, data):
        self.events.append((int(at), order, data))

    def marker(self, seconds, text):
        self.add(tick(seconds), 0, meta(0x06, text.encode("utf-8")))

    def cc(self, seconds, controller, value):
        self.add(tick(seconds), 1, bytes([0xb0 | self.channel, controller, value]))

    def note(self, seconds, dur, pitch, velocity):
        start, end = tick(seconds), tick(seconds + dur)
        self.add(start, 3, bytes([0x90 | self.channel, pitch, velocity]))
        self.add(end, 2, bytes([0x80 | self.channel, pitch, 0]))
        NOTES.append([round(seconds, 3), round(dur, 3), pitch, velocity, self.key])

    def render(self):
        self.add(tick(DURATION), 9, meta(0x2f, b""))
        ordered = sorted(self.events, key=lambda e: (e[0], e[1]))
        data = bytearray()
        last = 0
        for at, _, event in ordered:
            data += vlq(at - last) + event
            last = at
        return b"MTrk" + struct.pack(">I", len(data)) + data


conductor = Track("天下一統－導演軌", "conductor")
zheng = Track("古箏／撥弦", "zheng", 0, 107, 104, 58)       # Koto
bells = Track("編鐘", "bells", 1, 14, 96, 70)               # Tubular Bells
brass = Track("號角銅管", "brass", 2, 61, 102, 68)          # Brass Section
strings = Track("弦樂長音", "strings", 3, 48, 88, 64)       # String Ensemble
bass = Track("低音", "bass", 4, 43, 92, 64)                 # Contrabass
timpani = Track("定音鼓", "timpani", 5, 47, 106, 62)        # Timpani
gongs = Track("銅鑼", "gong", 6, 55, 110, 66)               # Orchestra Hit → 匯入後換成鑼
drums = Track("戰鼓", "drums", 9, None, 114, 64)            # GM percussion

tracks = [conductor, zheng, drums, bells, brass, strings, bass, timpani, gongs]

tempo = round(60_000_000 / BPM)
conductor.add(0, 0, meta(0x51, tempo.to_bytes(3, "big")))
conductor.add(0, 0, meta(0x58, bytes([4, 2, 24, 8])))
conductor.add(0, 0, meta(0x59, bytes([2, 0])))   # D major：兩個升記號
for when, label in [
    (0, "01 天下歸一"), (4.0, "02 天下一統"), (7.5, "03 詔書"),
    (13.0, "04 六國來朝"), (18.0, "05 慶功"), (24.0, "END 24.0s"),
]:
    conductor.marker(when, label)

# D 大調五聲：D E F# A B
D2, E2, Fs2, A2, B2 = 38, 40, 42, 45, 47
D3, E3, Fs3, A3, B3 = 50, 52, 54, 57, 59
D4, E4, Fs4, A4, B4 = 62, 64, 66, 69, 71
D5, E5, Fs5, A5, B5, D6 = 74, 76, 78, 81, 83, 86
beat = 60 / BPM

# ── 0.0–4.0 天下歸一：七國一國一國亮起（0.4 起每 0.5 秒一國）──
for note, vel in [(D2, 62), (A2, 48), (D3, 40)]:
    strings.note(0, 4.2, note, vel)
    bass.note(0, 4.1, note - 12 if note > D2 else note, max(32, vel - 14))
for i, note in enumerate([D4, E4, Fs4, A4, B4, D5, E5]):
    at = 0.4 + i * 0.5
    drums.note(at, .16, 36 if i % 2 == 0 else 41, 96 + i * 3)
    timpani.note(at, .3, [D2, A2][i % 2], 80 + i * 4)
    bells.note(at + .02, 1.1, note, 80 + i * 3)
drums.note(3.72, .1, 38, 90)
drums.note(3.86, .1, 38, 100)

# ── 4.0–7.5 天下一統：大字砸下（4.2），號角主題 ──
gongs.note(4.2, 3.0, D3, 120)
drums.note(4.2, .3, 49, 120)          # crash
drums.note(4.2, .2, 36, 127)
timpani.note(4.2, 1.2, D2, 124)
for note, vel in [(D3, 92), (A3, 84), (D4, 78), (Fs4, 72)]:
    brass.note(4.2, 1.1, note, vel)
fan = [(4.9, A3), (5.15, D4), (5.4, Fs4), (5.65, A4), (6.0, B4), (6.35, A4), (6.7, D5)]
for at, note in fan:
    brass.note(at, .34 if at < 6.6 else .8, note, 96)
for i in range(6):
    at = 4.9 + i * .43
    drums.note(at, .14, 36 if i % 2 == 0 else 41, 104)
    timpani.note(at, .26, D2 if i % 2 == 0 else A2, 96)

# ── 7.5–13.0 詔書：弦樂鋪底、古箏主旋律，比較莊重 ──
for note, vel in [(D3, 60), (A3, 50), (D4, 42), (Fs4, 38)]:
    strings.note(7.5, 5.6, note, vel)
bass.note(7.5, 5.5, D2, 58)
melody = [D4, E4, Fs4, A4, Fs4, E4, D4, A3, B3, D4, E4, Fs4, E4, D4]
for i, note in enumerate(melody):
    at = 7.7 + i * .37
    zheng.note(at, .34, note + 12, 82 + (i % 3) * 5)
for at in (7.5, 9.5, 11.5):
    timpani.note(at, .5, D2, 70)
bells.note(12.6, 1.0, D5, 84)

# ── 13.0–18.0 六國來朝：13.4 起每 0.6 秒一位（編鐘＋鼓） ──
for note, vel in [(D3, 64), (A3, 54), (D4, 46)]:
    strings.note(13.0, 5.2, note, vel)
bass.note(13.0, 5.1, D2, 60)
for i, note in enumerate([A4, B4, D5, E5, Fs5, A5]):
    at = 13.4 + i * .6
    bells.note(at, 1.4, note, 90 + i * 3)
    drums.note(at, .12, 41, 80)
    zheng.note(at + .3, .25, note - 12, 70)
drums.note(17.3, .1, 38, 96)
drums.note(17.5, .1, 38, 104)
drums.note(17.7, .1, 38, 112)

# ── 18.0–24.0 慶功：全體齊奏，22.0 定音，24.0 淡出 ──
gongs.note(18.0, 2.5, D3, 118)
drums.note(18.0, .3, 49, 118)
for note, vel in [(D2, 96), (A2, 80), (D3, 72), (Fs3, 64)]:
    strings.note(18.0, 5.8, note + 12, vel)
    bass.note(18.0, 5.8, note, max(40, vel - 20)) if note <= A2 else None
hero = [D4, Fs4, A4, B4, A4, D5, E5, Fs5, E5, D5, B4, D5]
for i, note in enumerate(hero):
    at = 18.1 + i * .31
    brass.note(at, .32, note, 94 + min(i, 5) * 3)
    zheng.note(at + .02, .28, note + 12, 80)
for i in range(12):
    at = 18.0 + i * beat
    drums.note(at, .14, 36 if i % 2 == 0 else 41, 112 if i % 4 == 0 else 90)
    timpani.note(at, .26, D2 if i % 2 == 0 else A2, 98)
    drums.note(at + beat / 2, .06, 42, 70)
# 22.0 定音：大和弦＋鑼
gongs.note(22.0, 2.0, D3, 124)
drums.note(22.0, .4, 49, 124)
drums.note(22.0, .2, 36, 127)
timpani.note(22.0, 1.6, D2, 127)
for note, vel in [(D3, 110), (A3, 100), (D4, 96), (Fs4, 90), (A4, 86)]:
    brass.note(22.0, 1.9, note, vel)
for note in (D5, Fs5, A5, D6):
    bells.note(22.02, 1.9, note, 96)

# 最後一秒 Expression 淡出，避免轉檔硬切尾
for tr in (zheng, bells, brass, strings, bass, timpani, gongs):
    for at, value in [(22.9, 127), (23.3, 96), (23.6, 64), (23.85, 30), (23.98, 0)]:
        tr.cc(at, 11, value)


def build():
    chunks = [t.render() for t in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b"".join(chunks))
    NOTES.sort(key=lambda n: n[0])
    OUT_JS.write_text(
        "/* 由 tools/build-unify-bgm-midi.py 產生，不要手改。\n"
        "   跟 unify-bgm.mid 同一份音符：GarageBand 的 MP3 還沒做好之前，預覽頁用瀏覽器合成來放。\n"
        "   每一筆：[起（秒）, 長（秒）, MIDI 音高, 力度, 軌] */\n"
        "window.MJ_UNIFY_NOTES = " + json.dumps(NOTES, ensure_ascii=False) + ";\n",
        encoding="utf-8")
    print(OUT)
    print(OUT_JS, len(NOTES), "notes")


if __name__ == "__main__":
    build()
