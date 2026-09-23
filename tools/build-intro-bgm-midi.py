#!/usr/bin/env python3
"""建立《一桌定江山》30 秒開場配樂的 Type 1 多軌 MIDI。

產出的分軌可直接匯入 GarageBand：
  1. 古箏／撥弦
  2. 戰鼓
  3. 編鐘
  4. 戰角銜管
  5. 弦樂長音
  6. 低音
  7. 定音鼓

不依賴第三方 MIDI 套件，方便以後隨時重建。
"""
from pathlib import Path
import struct

BPM = 112
TPQ = 480
DURATION = 30.0
OUT = Path(__file__).resolve().parents[1] / "assets" / "audio" / "intro-bgm.mid"


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


class Track:
    def __init__(self, name, channel=None, program=None, volume=100, pan=64):
        self.events = []
        self.add(0, 0, meta(0x03, name.encode("utf-8")))
        if channel is not None:
            if program is not None:
                self.add(0, 1, bytes([0xc0 | channel, program]))
            self.add(0, 1, bytes([0xb0 | channel, 7, volume]))
            self.add(0, 1, bytes([0xb0 | channel, 10, pan]))
            self.add(0, 1, bytes([0xb0 | channel, 91, 36]))   # reverb
            self.add(0, 1, bytes([0xb0 | channel, 93, 10]))   # chorus

    def add(self, at, order, data):
        self.events.append((int(at), order, data))

    def marker(self, seconds, text):
        self.add(tick(seconds), 0, meta(0x06, text.encode("utf-8")))

    def cc(self, seconds, channel, controller, value):
        self.add(tick(seconds), 1, bytes([0xb0 | channel, controller, value]))

    def note(self, seconds, dur, channel, pitch, velocity):
        start, end = tick(seconds), tick(seconds + dur)
        self.add(start, 3, bytes([0x90 | channel, pitch, velocity]))
        self.add(end, 2, bytes([0x80 | channel, pitch, 0]))

    def render(self):
        # 每軌精確結束在 30.0 秒，GarageBand 匯入後就是完整的 30 秒 region。
        self.add(tick(DURATION), 9, meta(0x2f, b""))
        ordered = sorted(self.events, key=lambda e: (e[0], e[1]))
        data = bytearray()
        last = 0
        for at, _, event in ordered:
            data += vlq(at - last) + event
            last = at
        return b"MTrk" + struct.pack(">I", len(data)) + data


# GM 音色號碼是 zero-based。GarageBand 可在匯入後對每軌換成任何軟體樂器。
conductor = Track("一桌定江山－導演軌")
zheng = Track("古箏／撥弦", 0, 107, 104, 58)       # Koto
bells = Track("編鐘／金屬餘韻", 1, 14, 94, 70)    # Tubular Bells
brass = Track("戰角銜管", 2, 60, 100, 68)             # French Horn
strings = Track("弦樂長音", 3, 48, 84, 64)           # String Ensemble
bass = Track("低音地鳴", 4, 43, 90, 64)             # Contrabass
timpani = Track("定音鼓", 5, 47, 104, 62)             # Timpani
drums = Track("戰鼓／打擊", 9, None, 112, 64)       # GM percussion channel

tracks = [conductor, zheng, drums, bells, brass, strings, bass, timpani]

# 導演軌：單一 tempo，以秒換算的 Marker 精確對齊六幕動畫。
tempo = round(60_000_000 / BPM)
conductor.add(0, 0, meta(0x51, tempo.to_bytes(3, "big")))
conductor.add(0, 0, meta(0x58, bytes([4, 2, 24, 8])))
conductor.add(0, 0, meta(0x59, bytes([0xff, 1])))  # D minor: one flat, minor
for when, label in [
    (0, "01 亂世開場"), (4.3, "02 七雄列陣"), (8.9, "03 四方對峙"),
    (14.2, "04 以牌為兵"), (20.3, "05 征服六國"), (25.3, "06 片名收尾"),
    (30.0, "END 30.0s"),
]:
    conductor.marker(when, label)

# MIDI note numbers：D minor pentatonic = D F G A C。
D2, F2, A2 = 38, 41, 45
D3, F3, G3, A3, C4 = 50, 53, 55, 57, 60
D4, F4, G4, A4, C5 = 62, 65, 67, 69, 72
D5, F5, G5, A5, C6, D6 = 74, 77, 79, 81, 84, 86

# 0.0–4.3 亂世開場：低鳴、編鐘、疏落古箏。
for note, vel in [(D2, 68), (A2, 50), (D3, 43)]:
    strings.note(0, 9.0, 3, note, vel)
    bass.note(0, 8.8, 4, note - 12 if note > D2 else note, max(34, vel - 16))
for note, vel in [(D2, 108), (A2, 82), (D3, 64)]:
    bells.note(.08, 4.1, 1, note, vel)
for at, note, vel in [(.85, D4, 88), (1.72, A4, 82), (2.62, G4, 84), (3.48, C5, 91)]:
    zheng.note(at, .76, 0, note, vel)

# 4.3–8.9 七雄列陣：七個鼓點各對應一位君主。
for i, note in enumerate([D4, F4, G4, A4, C5, A4, G4]):
    at = 4.34 + i * .56
    zheng.note(at + .045, .43, 0, note, 82 + (i % 3) * 4)
    drums.note(at, .16, 9, 41 if i % 2 else 36, 92 if i else 116)
    timpani.note(at, .28, 5, [D2, F2, A2][i % 3], 85 if i else 108)
drums.note(8.45, .08, 9, 37, 94)

# 8.9–14.2 四方對峙：行進鼓、戰角主題。
for note, vel in [(D2, 112), (A2, 84), (D3, 72)]:
    bells.note(8.82, 2.9, 1, note, vel)
beat = 60 / BPM
for i in range(10):
    at = 8.9 + i * beat
    drums.note(at, .14, 9, 36 if i % 4 == 0 else 41, 116 if i % 4 == 0 else 88)
    timpani.note(at, .26, 5, D2 if i % 2 == 0 else A2, 99 if i % 4 == 0 else 75)
    if i % 2:
        drums.note(at + beat * .5, .07, 9, 37, 69)
for i, note in enumerate([D3, D3, F3, G3, A3, G3, F3, D3]):
    brass.note(9.0 + i * beat * .72, .48, 2, note, 78 + (i % 4) * 4)

# 14.2–20.3 牌戰高潮：四張牌的重音，後接八分音符推進。
for note, vel in [(D3, 58), (A3, 46), (D4, 38)]:
    strings.note(13.7, 7.35, 3, note, vel)
for i, (at, note) in enumerate(zip([14.95, 15.23, 15.51, 15.79], [D4, F4, A4, D5])):
    drums.note(at, .18, 9, 36, 118)
    timpani.note(at, .34, 5, [D2, F2, A2, D3][i], 112)
    bells.note(at, .74, 1, note, 91)
for i in range(14):
    at = 16.15 + i * .285
    drums.note(at, .12, 9, 36 if i % 4 == 0 else 41, 96 if i % 4 == 0 else 74)
    if i % 2:
        drums.note(at + .14, .06, 9, 37, 62)
for i, note in enumerate([D4, F4, G4, A4, C5, A4, G4, F4, D4, G4, A4, C5]):
    zheng.note(16.05 + i * .34, .29, 0, note, 72 + (i % 4) * 4)

# 20.3–25.3 征服主題：上行旋律與較寬的戰鼓。
for note, vel in [(D2, 114), (A2, 88), (D3, 72)]:
    bells.note(20.22, 3.9, 1, note, vel)
for i in range(8):
    at = 20.3 + i * .61
    drums.note(at, .16, 9, 36 if i % 4 == 0 else 41, 110 if i % 4 == 0 else 77)
    timpani.note(at, .3, 5, D2 if i % 2 == 0 else A2, 91)
hero = [D4, F4, G4, A4, C5, A4, C5, D5, C5, A4]
for i, note in enumerate(hero):
    at = 20.42 + i * .46
    brass.note(at, .64, 2, note - 12, 81 + min(i, 4) * 3)
    zheng.note(at + .035, .45, 0, note, 77 + min(i, 4) * 3)

# 25.3–30.0 片名收尾：寬廣 Dm(add4) 和聲與最後定音。
for note, vel in [(D2, 120), (A2, 92), (D3, 78)]:
    bells.note(25.22, 4.35, 1, note, vel)
for note, vel in [(D2, 68), (A2, 52), (D3, 48), (F3, 43)]:
    strings.note(25.18, 4.72, 3, note, vel)
    bass.note(25.18, 4.65, 4, note - 12 if note >= D3 else note, max(38, vel - 13))
for i, note in enumerate([D5, F5, G5, A5, C6, D6]):
    at = 25.45 + i * .52
    brass.note(at, .78, 2, note - 12, 84 + i * 3)
    zheng.note(at + .035, .56, 0, note, 82 + i * 3)
drums.note(28.55, .22, 9, 36, 127)
drums.note(28.56, .35, 9, 49, 105)
timpani.note(28.55, .72, 5, D2, 122)
bells.note(28.58, 1.25, 1, D4, 108)
brass.note(28.62, 1.25, 2, D4, 112)
brass.note(28.64, 1.21, 2, A4, 96)

# 末秒 Expression 淡出，避免 GarageBand 轉檔時有硬切尾。
for tr, channel in [(zheng, 0), (bells, 1), (brass, 2), (strings, 3), (bass, 4), (timpani, 5)]:
    for at, value in [(28.85, 127), (29.18, 102), (29.48, 72), (29.75, 38), (29.96, 0)]:
        tr.cc(at, channel, 11, value)


def build():
    chunks = [track.render() for track in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b"".join(chunks))
    print(OUT)


if __name__ == "__main__":
    build()
