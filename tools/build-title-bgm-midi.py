#!/usr/bin/env python3
"""主畫面（title）的循環配樂。共用工具見 tools/bgm_midi.py。

    python3 tools/build-title-bgm-midi.py --render      ← 試聽（兩輪）
    python3 tools/build-title-bgm-midi.py --stems       ← 量各軌響度（調 gain_db 用）

原本 src/audio.js 的 buildTitle：古琴五聲（D E G A B）每 0.9 秒一個音、編鐘每 8 秒、山風、低頻共鳴。
曲風照舊 —— 開闊、沉靜、有古意；這版：
  64 BPM（原本一音 0.9 秒 ≈ 67），4/4，一輪 16 小節＝60 秒
   1– 4  山風、弦樂鋪底、編鐘一聲；古箏泛音零星點綴
   5– 8  古箏主題（原本那段古琴旋律：D E G A B → 回到低音 D）
   9–12  二胡應答，往高處走；大鑼輕輕一記
  13–16  古箏、二胡一起收回 D；大鼓輕敲，接回開頭
GarageBand 沒有古琴、編鐘 → 古箏代古琴，編鐘、山風用合成（exs_render 的 SynthBell／SynthWind）。
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

song = Song("title", bpm=64, bars=16, key_sig=(1, 0))      # G 大調的調號（D E G A B 都在裡面）

gz = song.track("古箏（主題）", program=107)
gzb = song.track("古箏（伴奏）", program=107)
gzh = song.track("古箏泛音", program=107)
eh = song.track("二胡", program=110)
st = song.track("弦樂", program=48)
bs = song.track("低音弦樂", program=43)
bell = song.track("編鐘", program=14)
wind = song.track("山風", program=122)
kit = song.track("中國鼓（鑼、大鼓）", drums=True)

# 主題：（小節, 拍, 長, 音）
THEME_A = [  # 5–8 古箏
    (5, 0, 1.5, "A4"), (5, 1.5, .5, "G4"), (5, 2, 1, "E4"), (5, 3, 1, "D4"),
    (6, 0, 1, "E4"), (6, 1, 1, "G4"), (6, 2, 2, "A4"),
    (7, 0, 1, "B4"), (7, 1, .5, "A4"), (7, 1.5, .5, "G4"), (7, 2, 1, "E4"), (7, 3, 1, "G4"),
    (8, 0, 3, "D4"),
]
THEME_B = [  # 9–12 二胡
    (9, 0, 2, "D5"), (9, 2, 1, "B4"), (9, 3, 1, "A4"),
    (10, 0, 1.5, "G4"), (10, 1.5, .5, "A4"), (10, 2, 2, "B4"),
    (11, 0, 1, "E5"), (11, 1, 1, "D5"), (11, 2, 1, "B4"), (11, 3, 1, "A4"),
    (12, 0, 3, "A4"),
]
THEME_C = [  # 13–16 古箏
    (13, 0, 1, "D5"), (13, 1, 1, "E5"), (13, 2, 1, "D5"), (13, 3, 1, "B4"),
    (14, 0, 1, "A4"), (14, 1, 1, "G4"), (14, 2, 2, "E4"),
    (15, 0, 1, "G4"), (15, 1, 1, "A4"), (15, 2, 1, "B4"), (15, 3, 1, "A4"),
    (16, 0, 2.5, "D4"),
]
ERHU_UNDER = [(13, "A4"), (14, "G4"), (15, "E4")]            # 13–15 二胡在下面拉長音
HARM = [(1, 2, "D5"), (2, 0, "A5"), (2, 2, "E5"), (3, 2, "D6"), (4, 0, "B5"), (4, 2, "A5")]   # 前奏的泛音

# 伴奏：每小節的分解和弦根音（古箏左手）
ROOTS = {1: None, 2: None, 3: None, 4: None, 5: "D3", 6: "D3", 7: "E3", 8: "D3",
         9: "G3", 10: "G3", 11: "E3", 12: "A3", 13: "D3", 14: "E3", 15: "G3", 16: "D3"}
# 弦樂和聲（小節範圍, 音）
PADS = [((1, 4), ("D3", "A3")), ((5, 8), ("D3", "A3", "D4")), ((9, 10), ("G3", "B3", "D4")),
        ((11, 12), ("E3", "A3", "C#4")), ((13, 15), ("D3", "A3", "D4")), ((16, 16), ("D3", "A3"))]

for L in song.loops():
    at = lambda bar, beat=0: song.at(L, bar, beat)
    for bar, beat, dur, p in THEME_A + THEME_C:
        gz.note(at(bar, beat), dur, p, 84 if bar < 13 else 90)
    for bar, beat, dur, p in THEME_B:
        eh.note(at(bar, beat), dur - .08, p, 82)
    for bar, p in ERHU_UNDER:
        eh.note(at(bar), 3.9, p, 66)
    eh.note(at(16), 2.4, "D4", 70)
    for bar, beat, p in HARM:
        gzh.note(at(bar, beat), 2, p, 72)
    for bar, r in ROOTS.items():
        if not r:
            continue
        root = n(r)
        for i, iv in enumerate((0, 7, 12, 7)):          # 根－五－八－五
            gzb.note(at(bar, i), .9, root + iv, 58 if i else 66)
    for (b0, b1), chord in PADS:
        st.chord(at(b0), (b1 - b0 + 1) * 4 - .1, chord, 62 if b0 < 9 else 70)
    bs.note(at(1), 32 - .1, "D2", 70)                     # 前半一路 D
    bs.note(at(9), 8 - .1, "G2", 70)
    bs.note(at(13), 16 - .1, "D2", 74)
    # 編鐘：每兩小節一聲（原本每 8 秒）。放在 D4／G3：低到 D3 會跟低音弦樂糊在一起、低頻太重
    for bar in range(1, 17, 2):
        bell.note(at(bar), 6, "D4" if bar not in (9, 11) else "G3", 92 if bar in (1, 9) else 74)
    bell.note(at(9, 2), 4, "A4", 60)
    bell.note(at(13, 2), 4, "D5", 58)
    # 大鑼：第 1、9 小節輕輕一記；13–16 大鼓輕敲推回開頭
    kit.note(at(1), 4, 49, 48)
    kit.note(at(9), 4, 49, 62)
    for bar in (13, 14, 15):
        kit.note(at(bar), 1, 36, 52)
    for i, beat in enumerate((0, 1, 2, 2.5, 3, 3.5)):
        kit.note(at(16, beat), .5, 36, 50 + i * 6)

# 山風：整首一個長音（循環版取中間那一輪，所以不會在接縫斷）
wind.note(0, song.loop_count * song.loop_beats, "G4", 90)


def erhu_release(sus_group, dur):
    m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
    string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
    long_ = "Long " if dur >= 0.8 else ""
    return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"


def instruments():
    from exs_render import Inst, SynthBell, SynthWind
    guzheng = dict(include=r"^Main Notes Plucked", release=1.2, max_len=4.0)
    return {
        "古箏（主題）": Inst("Chinese Traditional/Guzheng.exs", "pluck", pan=-0.15, reverb=0.45, gain_db=8.5, **guzheng),
        "古箏（伴奏）": Inst("Chinese Traditional/Guzheng.exs", "pluck", pan=-0.4, reverb=0.4, gain_db=4.5, **guzheng),
        "古箏泛音": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Harmonics", release=1.5, max_len=4.0,
                     pan=0.3, reverb=0.6, gain_db=5),
        "二胡": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$", release=0.4,
                   pan=0.2, reverb=0.5, gain_db=0, legato=0.15, release_group=erhu_release),
        "弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.0, pan=0.1, reverb=0.55, gain_db=-5),
        "低音弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.0, reverb=0.4, gain_db=-9.5),
        "編鐘": SynthBell(gain_db=-2.5, pan=-0.1, reverb=0.6),
        "山風": SynthWind(gain_db=0, reverb=0.1),
        "中國鼓（鑼、大鼓）": Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", max_len=6, reverb=0.45, gain_db=2.5),
    }


if __name__ == "__main__":
    song.main(instruments)
