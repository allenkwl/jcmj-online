#!/usr/bin/env python3
"""對局（game）的循環配樂。共用工具見 tools/bgm_midi.py。

    python3 tools/build-game-bgm-midi.py --render      ← 試聽（兩輪）
    python3 tools/build-game-bgm-midi.py --stems       ← 量各軌響度

原本 src/audio.js 的 buildGame：空五度弦樂鋪底（A2＋E3）、每 1.8 秒一次「咚咚」心跳低音、
零星的五聲撥弦（A B D E G，隨機跳過 45%）、風聲 —— 專注、暗暗的緊張。
這首整場一直放，所以要耐聽、不搶戲：音少、留白多，一輪拉長到 24 小節，免得一直聽到同一句。
  66 BPM，4/4，一輪 24 小節 ≈ 87 秒；心跳每兩拍一次（1.82 秒，跟原本一樣）
   1– 8  弦樂空五度、心跳、風；琵琶零星幾句
   9–16  古箏應答；二胡低音區拉長音
  17–24  低音一路往下走（A→G→F→E），琵琶輪指、古箏交錯，第 24 小節落回 A
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

song = Song("game", bpm=66, bars=24, key_sig=(0, 1))      # A 小調

pipa = song.track("琵琶", program=105)
trem = song.track("琵琶輪指", program=105)
gz = song.track("古箏", program=107)
eh = song.track("二胡", program=110)
st = song.track("弦樂", program=48)
bs = song.track("低音弦樂", program=43)
wind = song.track("風", program=122)
kit = song.track("心跳（大鼓）", drums=True)

# 琵琶零星的句子：（小節, 拍, 長, 音）—— 原本的音列 A B D E D A B G，拆成短句、中間留白
PIPA = [
    (3, 0, .5, "A4"), (3, .5, .5, "B4"), (3, 1, 1, "D5"),
    (4, 2, .5, "E5"), (4, 2.5, .5, "D5"), (4, 3, 1, "A4"),
    (6, 0, .5, "B4"), (6, .5, .5, "A4"), (6, 1, 2, "G4"),
    (7, 3, .5, "A4"), (7, 3.5, .5, "B4"),
    (8, 0, 2, "D5"),
    (17, 0, .5, "E5"), (17, .5, .5, "D5"), (17, 1, 1, "B4"),
    (18, 2, .5, "A4"), (18, 2.5, .5, "G4"), (18, 3, 1, "E4"),
    (21, 0, .5, "D5"), (21, .5, .5, "E5"), (21, 1, 1, "G5"),
    (22, 2, 1, "E5"), (22, 3, 1, "D5"),
]
TREM = [(19, 0, 4, "A4"), (20, 0, 3.5, "G4"), (23, 0, 4, "E4"), (24, 0, 3.5, "A4")]   # 輪指長音
GZ = [  # 古箏應答
    (9, 0, 1, "E4"), (9, 1, 1, "G4"), (9, 2, 2, "A4"),
    (10, 2, .5, "B4"), (10, 2.5, .5, "A4"), (10, 3, 1, "G4"),
    (11, 0, 2, "E4"),
    (12, 2, .5, "D4"), (12, 2.5, .5, "E4"), (12, 3, 1, "G4"),
    (14, 0, 1, "A4"), (14, 1, 1, "B4"), (14, 2, 2, "D5"),
    (15, 2, 1, "B4"), (15, 3, 1, "A4"),
    (16, 0, 3, "E4"),
    (20, 0, .5, "A3"), (20, .5, .5, "E4"), (20, 1, 1, "A4"),
    (24, 0, .5, "E4"), (24, .5, .5, "A4"), (24, 1, 2, "E5"),
]
ERHU = [(13, 0, 4, "A4"), (14, 0, 2, "G4"), (14, 2, 2, "E4"), (15, 0, 4, "D4"), (16, 0, 3.5, "E4")]
# 和聲：（小節範圍, 低音, 弦樂）—— 1–16 都是 A 的空五度；17 起低音往下走
HARM = [((1, 16), "A1", ("A2", "E3")), ((17, 18), "G1", ("G2", "D3")), ((19, 20), "F1", ("F2", "C3", "A3")),
        ((21, 22), "E1", ("E2", "B2", "G3")), ((23, 24), "E1", ("E2", "B2", "E3"))]

for L in song.loops():
    at = lambda bar, beat=0: song.at(L, bar, beat)
    for bar, beat, dur, p in PIPA:
        pipa.note(at(bar, beat), dur, p, 80)
    # 輪指：GarageBand 的輪指取樣只有 0.4 秒的起頭（循環點失效），拉長會變成一片嗡聲
    #       → 直接寫成連續快撥（每拍 9 下 ≈ 每秒 10 下），力度起伏，句尾漸弱
    for bar, beat, dur, p in TREM:
        k = int(dur * 9)
        for i in range(k):
            v = 70 + (6 if i % 3 == 0 else 0) - int(18 * max(0, i - k * .6) / (k * .4))
            trem.note(at(bar, beat + i / 9), 1 / 9, p, v)
    for bar, beat, dur, p in GZ:
        gz.note(at(bar, beat), dur, p, 78)
    for bar, beat, dur, p in ERHU:
        eh.note(at(bar, beat), dur - .08, p, 64)
    for (b0, b1), low, chord in HARM:
        beats = (b1 - b0 + 1) * 4 - .1
        bs.note(at(b0), beats, n(low) + 12, 66)          # 低音弦樂（低一個八度太悶，放 A2 這一區）
        st.chord(at(b0), beats, chord, 58)
    # 心跳：每兩拍「咚、咚」（第二下輕、晚 0.18 秒，跟原本一樣）
    for bar in range(1, 25):
        for beat in (0, 2):
            v = 70 if bar < 17 else 78
            kit.note(at(bar, beat), .3, 36, v)
            kit.note(at(bar, beat + 0.18 / song.beat), .3, 36, v - 22)

wind.note(0, song.loop_count * song.loop_beats, "E4", 80)


def erhu_release(sus_group, dur):
    m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
    string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
    long_ = "Long " if dur >= 0.8 else ""
    return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"


def instruments():
    from exs_render import Inst, SynthWind
    return {
        "琵琶": Inst("Pipa.exs", "pluck", include=r"^(A High|A Low|D|E) Open", release=0.8, max_len=3.0,
                   pan=-0.25, reverb=0.45, gain_db=-4),
        "琵琶輪指": Inst("Pipa.exs", "pluck", include=r"^(A High|A Low|D|E) Open", release=0.12, max_len=0.5,
                     pan=-0.2, reverb=0.45, gain_db=-9.5),
        "古箏": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked", release=1.0,
                   max_len=4.0, pan=0.3, reverb=0.45, gain_db=4.5),
        "二胡": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$", release=0.4,
                   pan=0.15, reverb=0.5, gain_db=-3, legato=0.15, release_group=erhu_release),
        "弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.0, reverb=0.5, gain_db=-6),
        "低音弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.0, reverb=0.35, gain_db=-6),
        "風": SynthWind(gain_db=0.5, reverb=0.1),
        "心跳（大鼓）": Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", max_len=2.5, reverb=0.3, gain_db=0),
    }


if __name__ == "__main__":
    song.main(instruments)
