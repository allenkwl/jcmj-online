#!/usr/bin/env python3
"""「擇國而立」畫面的循環配樂（Type 1 多軌 MIDI，試聽稿 v1），格式照 build-fallen-bgm-midi.py。

    python3 tools/build-select-bgm-midi.py --render     ← MIDI ＋ 用 GarageBand 的取樣演奏成 MP3（tools/exs_render.py）

為什麼改 MIDI（2026-10-16）：原本 src/audio.js 的 buildSelect 是三個 setInterval（大鼓／小鼓／旋律）各跑各的，
計時器晚到的量不一樣而且會累積，播一陣子鼓點就跟旋律對不上。使用者：「我打算改用 MIDI」。
做成音檔之後，所有聲部在同一條時間軸上，不可能再漂。

曲風照原本那首：緊張的戰鼓＋往上推的張力，A 小調五聲。原本的反覆樂句（A B C A G A B D）原樣保留，交給古箏。
125 BPM（原本大鼓每 0.48 秒＝125 BPM），4/4，一輪 16 小節＝30.72 秒，尾接頭可以無縫循環：
   1– 4  戰鼓＋古箏反覆樂句，低音弦撐著 A
   5– 8  小鼓進來，落在第 2、4 拍（原本程式註解說要「錯開半拍」，實際上沒錯開 —— 這裡照原意）；第 8 小節通鼓過門
   9–12  鈸一記，銅管重音，嗩吶吹出主題
  13–16  弦樂往上推（A→D→E），定音鼓改八分音符，第 16 小節大過門，落回第 1 小節

試聽稿把一輪寫兩次（61.44 秒），聽得出接縫順不順。定案之後只留一輪、遊戲裡用 AudioBuffer 循環。

v2（2026-10-16）：改成給 GarageBand 用（完整聲音資料庫已下載），每一軌在 GarageBand 換成：
  古箏 → Guzheng　　主旋律 → Erhu（沒有嗩吶、笛子，二胡拉緊張的旋律剛好）
  戰鼓組 → Chinese Kit　　太鼓 → Taiko Drums　　其餘 → 管弦樂的弦樂、銅管
沒有調得了音高的定音鼓，原本定音鼓的段落併進太鼓。
打擊樂的鍵位是讀 .exs 檔對出來的（Logic 的記法 C1＝36）：
  Chinese Kit：36 大鼓　41/43/45/47/48 排鼓（低→高）　42 水鈸　49 大鑼　54 小鈸　55 小鑼　24 梆子
  Taiko Drums：37 大太鼓（Odaiko）　38 桶胴（Okedo）　47/48 長胴（Nagado 中）　50 長胴（相撲）
fluidsynth 版（GM 音色）也還能轉，只是鼓會對到 GM 的鍵位、聽起來不對 —— 以 GarageBand 輸出的為準。
"""
from pathlib import Path
import re
import struct
import sys

BPM = 125
TPQ = 480
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 16
LOOPS = next((int(a) for a in sys.argv[1:] if a.isdigit()), 2)
DURATION = BARS * BAR * LOOPS
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio" / "select-bgm.mid"


def tick(beats):
    return round(beats * TPQ)


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
    """時間單位用「拍」（從頭算起），音樂寫起來比較直覺"""
    def __init__(self, name, channel=None, program=None, volume=100, pan=64, reverb=60):
        self.events = []
        self.add(0, 0, meta(0x03, name.encode("utf-8")))
        self.channel = channel
        if channel is not None:
            if program is not None:
                self.add(0, 1, bytes([0xc0 | channel, program]))
            self.add(0, 1, bytes([0xb0 | channel, 7, volume]))
            self.add(0, 1, bytes([0xb0 | channel, 10, pan]))
            self.add(0, 1, bytes([0xb0 | channel, 91, reverb]))

    def add(self, at, order, data):
        self.events.append((int(at), order, data))

    def marker(self, beats, text):
        self.add(tick(beats), 0, meta(0x06, text.encode("utf-8")))

    def note(self, beats, dur, pitch, velocity):
        start, end = tick(beats), tick(beats + dur)
        self.add(start, 3, bytes([0x90 | self.channel, pitch, max(1, min(127, velocity))]))
        self.add(end, 2, bytes([0x80 | self.channel, pitch, 0]))

    def render(self):
        self.add(tick(DURATION / BEAT), 9, meta(0x2f, b""))
        ordered = sorted(self.events, key=lambda e: (e[0], e[1]))
        data = bytearray()
        last = 0
        for at, _, event in ordered:
            data += vlq(at - last) + event
            last = at
        return b"MTrk" + struct.pack(">I", len(data)) + data


conductor = Track("擇國而立－導演軌")
zheng = Track("古箏（反覆樂句）", 0, 107, 96, 44, 50)
suona = Track("二胡（主旋律）", 1, 110, 84, 76, 70)
brass = Track("銅管重音", 2, 61, 92, 64, 60)
strings = Track("弦樂", 3, 48, 82, 70, 70)
trem = Track("顫弓弦樂", 4, 44, 70, 58, 70)
bass = Track("低音提琴", 5, 43, 96, 64, 40)
taiko = Track("太鼓（Taiko Drums）", 7, 116, 108, 64, 50)
drums = Track("戰鼓組（Chinese Kit）", 9, None, 112, 64, 40)
timpani = taiko                          # 沒有定音鼓：定音鼓的段落交給太鼓

tracks = [conductor, zheng, suona, brass, strings, trem, bass, taiko, drums]

conductor.add(0, 0, meta(0x51, round(60_000_000 / BPM).to_bytes(3, "big")))
conductor.add(0, 0, meta(0x58, bytes([4, 2, 24, 8])))
conductor.add(0, 0, meta(0x59, bytes([0, 1])))   # A 小調

# 音名
A1, E2, G2 = 33, 40, 43
A2, C3, D3, E3, G3, Gs3 = 45, 48, 50, 52, 55, 56
A3, B3, C4, D4, E4, G4 = 57, 59, 60, 62, 64, 67
A4, B4, C5, D5, E5, G5 = 69, 71, 72, 74, 76, 79

# Chinese Kit
KICK, SNARE, CRASH, CHINA = 36, 48, 49, 42     # 大鼓、高音排鼓（當小鼓）、大鑼、水鈸
TOMS = [48, 47, 45, 43, 41, 41]                # 排鼓 高 → 低
# Taiko Drums
ODAIKO, OKEDO, NAGADO_HI, NAGADO_LO, SUMO = 37, 38, 48, 47, 50

RIFF = [A4, B4, C5, A4, G4, A4, B4, D5]  # 原本 buildSelect 的 riff ×2（220,247,262,220,196,220,247,294 Hz 的高八度）

THEME = [  # 嗩吶主題，第 9–16 小節：（小節內第幾拍, 長, 音）
    (9, 0, 2, E5), (9, 2, 1, D5), (9, 3, 1, C5),
    (10, 0, 3, A4), (10, 3, 1, G4),
    (11, 0, 1, A4), (11, 1, 1, C5), (11, 2, 2, D5),
    (12, 0, 4, E5),
    (13, 0, 2, G5), (13, 2, 1, E5), (13, 3, 1, D5),
    (14, 0, 2, E5), (14, 2, 1, D5), (14, 3, 1, C5),
    (15, 0, 1, D5), (15, 1, 1, C5), (15, 2, 2, A4),
    (16, 0, 2, A4),
]


def b(loop, bar, beat=0.0):
    """第 loop 輪、第 bar 小節（1 起算）、第 beat 拍（0 起算）→ 從頭算起的拍數"""
    return loop * BARS * 4 + (bar - 1) * 4 + beat


def one_loop(L):
    conductor.marker(b(L, 1), f"第 {L + 1} 輪")

    # ── 戰鼓：大鼓每拍（原本就是每拍一下），太鼓落在 1、3 拍 ──
    for bar in range(1, BARS + 1):
        for beat in range(4):
            acc = 10 if beat == 0 else 0
            drums.note(b(L, bar, beat), .25, KICK, 96 + acc + (8 if bar >= 9 else 0))
        for beat in (0, 2):
            taiko.note(b(L, bar, beat), .8, ODAIKO, 100 if beat == 0 else 86)
        # 小鼓：第 5 小節起落在 2、4 拍
        if bar >= 5 and bar not in (8, 16):
            for beat in (1, 3):
                drums.note(b(L, bar, beat), .2, SNARE, 92 + (10 if bar >= 13 else 0))
        # 13–16：小鼓在第 4 拍的後半多一下，推著往前
        if 13 <= bar <= 15:
            drums.note(b(L, bar, 3.5), .15, SNARE, 78)

    # 過門：第 8 小節後兩拍、第 16 小節整小節
    for i in range(8):
        drums.note(b(L, 8, 2 + i * .25), .2, TOMS[min(5, i * 6 // 8)], 84 + i * 4)
    drums.note(b(L, 8, 0), .2, SNARE, 96); drums.note(b(L, 8, 1), .2, SNARE, 96)
    for i in range(16):
        drums.note(b(L, 16, i * .25), .2, TOMS[min(5, i * 6 // 16)] if i < 12 else SNARE, 80 + i * 3)
    timpani.note(b(L, 16, 3), .9, SUMO, 120)   # 最後一拍重擊，回到第 1 小節

    # 鈸
    drums.note(b(L, 1), 1.5, CRASH, 104 if L == 0 else 116)
    drums.note(b(L, 9), 1.5, CRASH, 118)
    drums.note(b(L, 13), 1.5, CHINA, 110)

    # ── 古箏：反覆樂句一路八分音符 ──
    for bar in range(1, BARS + 1):
        if bar == 16:
            # 最後一小節只彈前兩拍，留空給過門
            for i in range(4):
                zheng.note(b(L, bar, i * .5), .45, RIFF[i], 84)
            continue
        for i in range(8):
            accent = 12 if i % 4 == 0 else 0
            base = 70 if bar <= 4 else 78
            zheng.note(b(L, bar, i * .5), .45, RIFF[i], base + accent)

    # ── 低音：A 撐住，後段往上推 ──
    roots = {**{bar: A1 for bar in range(1, 13)}, 13: D3 - 24, 14: D3 - 24, 15: E2, 16: E2}
    for bar in range(1, BARS + 1):
        r = roots[bar]
        for beat in (0, 1.5, 2, 3.5) if bar >= 5 else (0, 2):
            bass.note(b(L, bar, beat), .45 if beat % 1 else .9, r, 92 if beat == 0 else 78)

    # ── 弦樂和聲 ──
    for bars, chord, vel in [
        ((5, 8), (A2, E3), 64),
        ((9, 12), (A2, C3, E3), 74),
        ((13, 14), (D3, A3), 84),
        ((15, 15), (E3, B3), 90),
        ((16, 16), (E3, Gs3), 96),            # 屬和弦的導音：往第 1 小節的 A 拉
    ]:
        start, end = b(L, bars[0]), b(L, bars[1] + 1)
        for n in chord:
            strings.note(start, end - start - .05, n, vel)

    # 顫弓：13–16 小節越來越高
    for bar, n in [(13, A3), (14, A3), (15, C4), (16, D4)]:
        trem.note(b(L, bar), 3.95, n, 70 + (bar - 13) * 10)
        trem.note(b(L, bar), 3.95, n + 12, 56 + (bar - 13) * 8)

    # ── 銅管重音 ──
    for bar in (9, 11):
        for n in (A2, E3, A3):
            brass.note(b(L, bar), .7, n, 100)
    for bar in (13, 14, 15):
        chord = (D3, A3, D4) if bar < 15 else (E3, B3, E4)
        for beat in (0, 2):
            for n in chord:
                brass.note(b(L, bar, beat), .6, n, 104 if beat == 0 else 92)

    # ── 定音鼓 ──
    for bar in (1, 3):
        timpani.note(b(L, bar), 1, SUMO, 96)
    for bar in range(13, 16):
        for i in range(8):
            timpani.note(b(L, bar, i * .5), .45, NAGADO_LO if i % 2 == 0 else NAGADO_HI, 78 + i * 3)

    # ── 嗩吶主題 ──
    for bar, beat, dur, n in THEME:
        suona.note(b(L, bar, beat), dur - .05, n, 92 if bar >= 13 else 84)


for L in range(LOOPS):
    one_loop(L)
conductor.marker(DURATION / BEAT, f"END {DURATION:.2f}s")


def build():
    chunks = [t.render() for t in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b"".join(chunks))
    print(OUT, f"{LOOPS} 輪，{DURATION:.2f} 秒")


sys.path.insert(0, str(Path(__file__).resolve().parent))


def erhu_release(sus_group, dur):
    """撐音「Sus A Down rr1 A」→ 收弓「Rel A A」；長音（0.8 秒以上）用「Rel Long A A」。GB 弦沒有力度層"""
    m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
    string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
    long_ = "Long " if dur >= 0.8 else ""
    return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"


def instruments():
    """每一軌用哪個 GarageBand 樂器（gain_db 是用 --stems 量各軌響度調出來的）"""
    from exs_render import Inst
    strings = dict(kind="sustain", release=0.5, reverb=0.45)
    mapping = {
        "古箏（反覆樂句）": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked",
                            release=0.6, pan=-0.35, reverb=0.3, gain_db=6.5),
        "二胡（主旋律）": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$",
                          release=0.3, pan=0.15, reverb=0.4, gain_db=4, legato=0.15,
                          release_group=erhu_release),
        "銅管重音": Inst("09 Orchestral/02 Brass/Full Brass Staccato.exs", "pluck", exclude=r"Dummy", layer=lambda g: g.split("_")[0],
                     release=0.35, reverb=0.45, gain_db=-5),
        "弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", pan=0.25, gain_db=-5, **strings),
        "顫弓弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", pan=-0.2, gain_db=-4, **strings),
        "低音提琴": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "pluck", release=0.3, reverb=0.25, gain_db=3),
        "太鼓（Taiko Drums）": Inst("Japanese Traditional/Taiko Drums.exs", "oneshot", max_len=3, reverb=0.3, gain_db=-7.5),
        "戰鼓組（Chinese Kit）": Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", max_len=4,
                                reverb=0.25, gain_db=-2),
    }
    return mapping


def render_mp3():
    """用 GarageBand 的取樣演奏（tools/exs_render.py）→ assets/audio/select-bgm.mp3"""
    from exs_render import render, to_mp3
    wav = OUT.with_suffix(".wav")
    render(OUT, instruments(), wav, total_seconds=DURATION + 1.5)
    (ROOT / "assets" / "audio" / "試聽").mkdir(parents=True, exist_ok=True)
    mp3 = to_mp3(wav, ROOT / "assets" / "audio" / "試聽" / "select.mp3", fade=(DURATION, 1.4))
    wav.unlink()
    print(mp3)


if __name__ == "__main__":
    build()
    if "--stems" in sys.argv:
        from exs_render import stem_loudness
        for k, v in stem_loudness(OUT, instruments(), seconds=BARS * BAR).items():
            print(f"  {k:24s} {v:6.1f} LUFS")
    if "--render" in sys.argv:
        render_mp3()
    if "--game" in sys.argv:
        # 遊戲版：跟 tools/bgm_midi.py 的 --game 同一套（一輪、前後各補 PAD 秒、寫進 manifest.js）
        import numpy as np
        import soundfile as sf
        from exs_render import render, to_mp3
        from bgm_midi import GAME_DIR, PAD, update_manifest
        assert LOOPS >= 2
        out = GAME_DIR / "select.mp3"
        out.parent.mkdir(parents=True, exist_ok=True)
        wav = out.with_suffix(".wav")
        render(OUT, instruments(), wav, loop_seconds=BARS * BAR)
        x, sr = sf.read(str(wav), dtype="float32")
        p = int(PAD * sr)
        sf.write(str(wav), np.concatenate([x[-p:], x, x[:p]]), sr, subtype="PCM_24")
        to_mp3(wav, out, quality=4)
        wav.unlink()
        update_manifest("select", "select.mp3", BARS * BAR)
        print(out)
