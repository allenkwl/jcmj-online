#!/usr/bin/env python3
"""建立「亡國」動畫的 14 秒配樂（Type 1 多軌 MIDI），格式照 build-unify-bgm-midi.py。

    python3 tools/build-fallen-bgm-midi.py
    bash tools/render-bgm.sh assets/audio/fallen-bgm.mid assets/audio/fallen-bgm.mp3 14

產出：
  ‧ assets/audio/fallen-bgm.mid       ← 也可以匯入 GarageBand 換樂器，轉成 MP3 蓋掉 fallen-bgm.mp3
  ‧ assets/audio/fallen-bgm.notes.js  ← 同一份音符；沒有 MP3 時 src/fallen.js 用瀏覽器合成來放
  ‧ assets/audio/fallen-bgm.mp3       ← render-bgm.sh 用 fluidsynth 轉的

2026-10-14 使用者同意的方向：五聲羽調（La Do Re Mi Sol，A 羽）、很慢、旋律往下走、停在低音不收圓滿；
塤主旋律、古箏、編鐘、大鑼、低音弦樂、戰鼓 —— 關鍵是「出征的鼓聲在劍斷那一刻戛然而止」。
七國共用同一段。

時間軸跟動畫共用（src/fallen.js 的 T）—— 改這裡的秒數，那邊也要跟著改：
  0.0– 0.9  主公出征的最後一刻：戰鼓延續（越打越急）
  0.9       劍斷：鼓聲戛然而止，編鐘一聲
  0.9– 3.0  踉蹌、跪下：低音弦樂鋪底，古箏顫音；2.6 跪地（定音鼓一記悶響）
  3.0– 8.0  灰燼飄落、山河變灰：塤進來，緩慢往下走
  8.0       「○亡」大字砸下：大鑼重擊
  8.0–14.0  戰績、征途回顧：塤收尾落在低音的羽，跟風聲一起淡出

塤在 General MIDI 裡沒有，用 Ocarina（79）在低音域代替（塤本來就是陶土做的球形笛，跟陶笛同一類）。
鑼也沒有，用 Taiko（116）的低音加鈸代替；瀏覽器合成那一版有真的鑼聲（src/fallen.js）。
"""
from pathlib import Path
import json
import struct

BPM = 60            # 一拍一秒，秒數直接就是拍數，好對時間軸
TPQ = 480
DURATION = 14.0
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio" / "fallen-bgm.mid"
OUT_JS = ROOT / "assets" / "audio" / "fallen-bgm.notes.js"


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
    def __init__(self, name, key, channel=None, program=None, volume=100, pan=64, reverb=70):
        self.key = key
        self.events = []
        self.add(0, 0, meta(0x03, name.encode("utf-8")))
        if channel is not None:
            if program is not None:
                self.add(0, 1, bytes([0xc0 | channel, program]))
            self.add(0, 1, bytes([0xb0 | channel, 7, volume]))
            self.add(0, 1, bytes([0xb0 | channel, 10, pan]))
            self.add(0, 1, bytes([0xb0 | channel, 91, reverb]))   # 殘響開大一點：空曠、蒼涼
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


conductor = Track("亡國－導演軌", "conductor")
xun = Track("塤（Ocarina 代）", "xun", 0, 79, 110, 60, 90)
zheng = Track("古箏", "zheng", 1, 107, 92, 50)
bells = Track("編鐘", "bells", 2, 14, 92, 70, 90)
strings = Track("低音弦樂", "strings", 3, 48, 84, 64, 80)
bass = Track("低音", "bass", 4, 43, 88, 64)
timpani = Track("定音鼓", "timpani", 5, 47, 104, 62)
gongs = Track("大鑼（Taiko 代）", "gong", 6, 116, 118, 66, 100)
wind = Track("風聲", "wind", 7, 122, 46, 64, 60)              # Seashore：低音量當風聲
drums = Track("戰鼓", "drums", 9, None, 112, 64)

tracks = [conductor, xun, zheng, bells, strings, bass, timpani, gongs, wind, drums]

tempo = round(60_000_000 / BPM)
conductor.add(0, 0, meta(0x51, tempo.to_bytes(3, "big")))
conductor.add(0, 0, meta(0x58, bytes([4, 2, 24, 8])))
conductor.add(0, 0, meta(0x59, bytes([0, 1])))   # A 小調（羽調用 A 小調的調號記）
for when, label in [
    (0, "01 出征最後一刻"), (0.9, "02 劍斷・鼓止"), (3.0, "03 灰燼・塤"),
    (8.0, "04 ○亡"), (14.0, "END 14.0s"),
]:
    conductor.marker(when, label)

# A 羽調五聲：A C D E G
A1, C2, D2, E2, G2 = 33, 36, 38, 40, 43
A2, C3, D3, E3, G3 = 45, 48, 50, 52, 55
A3, C4, D4, E4, G4 = 57, 60, 62, 64, 67
A4, C5, D5, E5 = 69, 72, 74, 76

# ── 0.0–0.9 出征的最後一刻：戰鼓越打越急 ──
for at, vel in [(0.0, 118), (0.3, 104), (0.5, 108), (0.65, 112), (0.76, 116), (0.85, 122)]:
    drums.note(at, .12, 36, vel)                  # 大鼓
    timpani.note(at, .2, A1 + 12, vel - 20)
drums.note(0.0, .4, 49, 100)                      # 開頭一記鈸，接上主公出征
for at in (0.15, 0.4, 0.58, 0.71, 0.81):
    drums.note(at, .06, 38, 84)                   # 小鼓填空

# ── 0.9 劍斷：鼓聲戛然而止，編鐘一聲（之後 2 秒內沒有任何打擊樂）──
bells.note(0.9, 3.5, A3, 104)
bells.note(0.9, 3.5, E4, 70)
drums.note(0.9, .5, 52, 78)                       # 中國鈸一擦，像金屬斷裂

# ── 0.9–3.0 踉蹌、跪下：低音弦樂鋪底，古箏顫音 ──
strings.note(1.0, 7.0, A2, 70)
strings.note(1.0, 7.0, E3, 56)
bass.note(1.0, 7.0, A1, 66)
for i in range(14):                               # 古箏在 E3 上輪指，越來越弱
    zheng.note(1.15 + i * 0.1, 0.1, E3 if i % 2 == 0 else D3, max(36, 78 - i * 3))
timpani.note(2.6, 1.6, A1, 96)                    # 跪地：一記悶響
zheng.note(2.6, 1.2, A2, 70)

# ── 3.0–8.0 灰燼飄落：塤進來，緩慢往下走 ──
phrase1 = [(3.2, 1.0, E4), (4.2, .5, D4), (4.7, .5, C4), (5.2, 1.4, A3),
           (6.7, .5, C4), (7.2, .4, D4), (7.6, .5, C4)]
for at, dur, note in phrase1:
    xun.note(at, dur, note, 88)
for at, note in [(3.2, A2), (5.2, E2), (6.7, G2)]:
    zheng.note(at, .8, note + 12, 58)             # 古箏點在每一句的開頭
wind.note(3.0, 11.0, 60, 40)                      # 風聲從這裡一直到最後

# ── 8.0 「○亡」：大鑼重擊 ──
gongs.note(8.0, 4.0, A1, 127)
drums.note(8.0, .6, 52, 116)
drums.note(8.0, .3, 35, 127)
timpani.note(8.0, 2.5, A1, 124)
strings.note(8.0, 5.6, A2, 84)
strings.note(8.0, 5.6, E3, 70)
strings.note(8.0, 5.6, C4, 58)                    # 小三度：最暗的那一下
bass.note(8.0, 5.6, A1, 80)
bells.note(8.05, 4.0, A2, 96)

# ── 8.5–14.0 戰績：塤收尾，停在低音的羽 ──
phrase2 = [(8.9, .8, G3), (9.7, .6, E3), (10.3, .5, D3), (10.8, .5, C3), (11.3, 2.4, A2 + 12)]
for at, dur, note in phrase2:
    xun.note(at, dur, note + 12, 84)              # 塤的音域：高一個八度才不會糊在低音裡
zheng.note(11.3, 2.2, A2, 54)
bells.note(12.2, 1.8, A3, 52)                     # 最後一聲很遠的鐘

# 最後 1.2 秒 Expression 淡出
for tr in (xun, zheng, bells, strings, bass, timpani, gongs, wind):
    for at, value in [(12.8, 127), (13.2, 90), (13.5, 56), (13.8, 24), (13.98, 0)]:
        tr.cc(at, 11, value)


def build():
    chunks = [t.render() for t in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b"".join(chunks))
    NOTES.sort(key=lambda n: n[0])
    OUT_JS.write_text(
        "/* 由 tools/build-fallen-bgm-midi.py 產生，不要手改。\n"
        "   跟 fallen-bgm.mid 同一份音符：沒有 MP3 時 src/fallen.js 用瀏覽器合成來放。\n"
        "   每一筆：[起（秒）, 長（秒）, MIDI 音高, 力度, 軌] */\n"
        "window.MJ_FALLEN_NOTES = " + json.dumps(NOTES, ensure_ascii=False) + ";\n",
        encoding="utf-8")
    print(OUT)
    print(OUT_JS, len(NOTES), "notes")


if __name__ == "__main__":
    build()
