#!/usr/bin/env python3
"""聽牌（tenpai）的循環配樂：有人聽牌時切過來（舊兩人版的做法，四人版要補回來）。共用工具見 tools/bgm_midi.py。

    python3 tools/build-tenpai-bgm-midi.py --render      ← 試聽（兩輪）
    python3 tools/build-tenpai-bgm-midi.py --stems       ← 量各軌響度

原本 src/audio.js 的 buildTenpai：160 BPM、每拍大鼓、2／4 拍小鼓、D–E♭ 小二度來回的急促顫音（D E♭ D E♭ C C♯ C C♯）、
每兩拍往下走一階的低音（A G F E E♭ D C♯ C）、高音 D 的持續音帶快速顫音、低頻噪音 —— 最緊張的一首。
  160 BPM，4/4，一輪 24 小節＝36 秒（聽牌可能一聽很久，太短會一直重複）
   1– 8  大鼓每拍、琵琶小二度來回（八分音符）、低音一路往下
   9–16  加上排鼓（2、4 拍）、弦樂高音持續、二胡拉長音
  17–24  加上太鼓八分音符、銅管重音、大鑼；第 24 小節過門
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

song = Song("tenpai", bpm=160, bars=24, key_sig=(-1, 1))   # D 小調

ost = song.track("琵琶（小二度來回）", program=105)
eh = song.track("二胡", program=110)
st = song.track("弦樂高音", program=48)
bs = song.track("低音弦樂", program=43)
brass = song.track("銅管重音", program=61)
taiko = song.track("太鼓", program=116)
kit = song.track("中國鼓", drums=True)

OST = ["D5", "Eb5", "D5", "Eb5", "C5", "C#5", "C5", "C#5"]          # 原本的顫音音型
BASS = ["A2", "G2", "F2", "E2", "Eb2", "D2", "C#2", "C2"]             # 每兩拍一階
ERHU = [(9, 4, "D5"), (10, 4, "Eb5"), (11, 4, "D5"), (12, 4, "C5"),
        (13, 2, "D5"), (13.5, 2, "F5"), (14, 4, "Eb5"), (15, 4, "D5"), (16, 4, "C#5")]
HIGH = [((9, 12), ("D5",)), ((13, 16), ("D5", "A5")), ((17, 20), ("D5", "Eb5")), ((21, 24), ("D5", "A5"))]

DAGU, PAIGU_HI, PAIGU_MID, PAIGU_LO, DALUO, SHUIBO, XIAOBO = 36, 48, 45, 41, 49, 42, 54
ODAIKO, NAGADO_HI, NAGADO_LO = 37, 48, 47

for L in song.loops():
    at = lambda bar, beat=0: song.at(L, bar, beat)
    for bar in range(1, 25):
        # 大鼓每拍
        for beat in range(4):
            kit.note(at(bar, beat), .25, DAGU, 96 + (10 if beat == 0 else 0) + (6 if bar > 16 else 0))
        # 排鼓（當小鼓）2、4 拍
        if bar >= 9 and bar != 24:
            for beat in (1, 3):
                kit.note(at(bar, beat), .25, PAIGU_HI, 92 if bar < 17 else 100)
        # 太鼓八分音符
        if bar >= 17 and bar != 24:
            for i in range(8):
                taiko.note(at(bar, i * .5), .4, NAGADO_HI if i % 2 else NAGADO_LO, 72 + (14 if i % 4 == 0 else 0))
        # 琵琶小二度來回（八分音符，一小節剛好一輪音型）
        for i, p in enumerate(OST):
            ost.note(at(bar, i * .5), .45, p, 82 if i % 4 == 0 else 70)
        # 低音每兩拍往下一階（四小節走完一輪）
        for h in range(2):
            idx = ((bar - 1) * 2 + h) % 8
            bs.note(at(bar, h * 2), 1.9, BASS[idx], 86)
    # 弦樂高音持續
    for (b0, b1), chord in HIGH:
        st.chord(at(b0), (b1 - b0 + 1) * 4 - .1, chord, 70 if b0 < 17 else 80)
    # 二胡長音（9–16），17–20 再拉一次前四小節（更用力）
    for bar, beats, p in ERHU:
        eh.note(at(int(bar), (bar % 1) * 4), beats - .1, p, 86)
    for bar, beats, p in ERHU[:4]:
        eh.note(at(bar + 8), beats - .1, p, 96)
    # 銅管重音、大鑼
    for bar in (17, 19, 21, 23):
        brass.chord(at(bar), .6, ("D3", "A3", "D4"), 100)
        brass.chord(at(bar, 2.5), .4, ("Eb3", "Bb3", "Eb4"), 92)
    kit.note(at(1), 2, DALUO, 70 if L == 0 else 90)
    kit.note(at(9), 2, SHUIBO, 92)
    kit.note(at(17), 2, DALUO, 108)
    # 第 24 小節過門：排鼓從高到低
    for i in range(16):
        kit.note(at(24, i * .25), .2, [PAIGU_HI, PAIGU_MID, PAIGU_LO][min(2, i * 3 // 16)], 80 + i * 3)
    taiko.note(at(24, 3), 1, ODAIKO, 120)


def instruments():
    import re
    from exs_render import Inst

    def erhu_release(sus_group, dur):
        m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
        string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
        long_ = "Long " if dur >= 0.8 else ""
        return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"

    return {
        "琵琶（小二度來回）": Inst("Pipa.exs", "pluck", include=r"^(A High|A Low|D|E) Open", release=0.15, max_len=0.8,
                          pan=-0.25, reverb=0.3, gain_db=-3),
        "二胡": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$", release=0.3,
                   pan=0.2, reverb=0.4, gain_db=0, legato=0.15, release_group=erhu_release),
        "弦樂高音": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=0.6, pan=0.1, reverb=0.45, gain_db=-4.5),
        "低音弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=0.25, reverb=0.25, gain_db=-3),
        "銅管重音": Inst("09 Orchestral/02 Brass/Full Brass Staccato.exs", "pluck", exclude=r"Dummy", layer=lambda g: g.split("_")[0], release=0.3,
                     reverb=0.4, gain_db=-8),
        "太鼓": Inst("Japanese Traditional/Taiko Drums.exs", "oneshot", max_len=2.5, reverb=0.3, gain_db=-9.5),
        "中國鼓": Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", max_len=3, reverb=0.25, gain_db=-3),
    }


if __name__ == "__main__":
    song.main(instruments)
