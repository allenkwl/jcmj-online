#!/usr/bin/env python3
"""「分封領地」動畫的循環配樂（試聽稿 v1）。共用工具見 tools/bgm_midi.py。

    python3 tools/build-enfeoff-bgm-midi.py --render     ← 試聽（兩輪，assets/audio/試聽/enfeoff.mp3）
    python3 tools/build-enfeoff-bgm-midi.py --stems      ← 量各軌響度

2026-10-28 使用者：「分封動畫沒有相應的 BGM，是不是做一曲？一樣用 Garage band 來轉」。
以前分封時把遊戲的 BGM 停掉，只有程式合成的戰鼓、銅鑼、號角音效（src/enfeoff.js 的 SND）。

論功行賞的場面：莊重、帶凱旋感的行進曲，比「天下一統」那首內斂 —— 留給統一時再爆發。
分封動畫的長度看有幾位主公受封（一位約 4 秒），所以做成循環。
  G 大調五聲（G A B D E），96 BPM，4/4，一輪 16 小節＝40 秒；和聲每小節 G｜Em｜C｜D
   1– 4  戰鼓踏步（1、3 拍）、古箏分解和弦、弦樂鋪底、低音
   5– 8  二胡唱出主旋律
   9–12  水鈸一記、銅管號角、太鼓重音；二胡再唱一次（往上走）
  13–16  全體：旋律推到高音、琵琶撥奏加進來；第 16 小節排鼓過門，接回第 1 小節
動畫原本的戰鼓、銅鑼、號角音效保留，疊在上面。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

song = Song("enfeoff", bpm=96, bars=16, key_sig=(1, 0))      # G 大調

gz = song.track("古箏", program=107)
eh = song.track("二胡", program=110)
pipa = song.track("琵琶", program=105)
st = song.track("弦樂", program=48)
bs = song.track("低音弦樂", program=43)
brass = song.track("銅管", program=61)
taiko = song.track("太鼓", program=116)
kit = song.track("中國鼓", drums=True)

CHORDS = ["G", "Em", "C", "D"]
ARP = {   # 古箏分解和弦（八分音符一小節八個）
    "G":  ["G3", "D4", "G4", "B4", "D5", "B4", "G4", "D4"],
    "Em": ["E3", "B3", "E4", "G4", "B4", "G4", "E4", "B3"],
    "C":  ["C3", "G3", "C4", "E4", "G4", "E4", "C4", "G3"],
    "D":  ["D3", "A3", "D4", "F#4", "A4", "F#4", "D4", "A3"],
}
PAD = {"G": ("G3", "B3", "D4"), "Em": ("E3", "G3", "B3"), "C": ("C3", "E3", "G3"), "D": ("D3", "F#3", "A3")}
ROOTB = {"G": "G2", "Em": "E2", "C": "C2", "D": "D2"}
BRASS = {"G": ("G3", "B3", "D4"), "C": ("C3", "G3", "E4")}

# 二胡主旋律：(小節, 拍, 拍數, 音)
MEL = [
    (5, 0, 2, "G4"), (5, 2, 1, "A4"), (5, 3, 1, "B4"),
    (6, 0, 3, "D5"), (6, 3, 1, "B4"),
    (7, 0, 1, "A4"), (7, 1, 1, "G4"), (7, 2, 2, "E4"),
    (8, 0, 4, "D4"),
    (9, 0, 1, "G4"), (9, 1, 1, "A4"), (9, 2, 1, "B4"), (9, 3, 1, "D5"),
    (10, 0, 2, "E5"), (10, 2, 2, "D5"),
    (11, 0, 1, "B4"), (11, 1, 1, "D5"), (11, 2, 2, "A4"),
    (12, 0, 4, "G4"),
    (13, 0, 1, "D5"), (13, 1, 1, "E5"), (13, 2, 2, "G5"),
    (14, 0, 1, "E5"), (14, 1, 1, "D5"), (14, 2, 2, "B4"),
    (15, 0, 1, "A4"), (15, 1, 1, "B4"), (15, 2, 1, "D5"), (15, 3, 1, "E5"),
    (16, 0, 3, "D5"),
]

DAGU, PAIGU_HI, PAIGU_MID, PAIGU_LO, DALUO, SHUIBO, XIAOBO = 36, 48, 45, 41, 49, 42, 54
ODAIKO, NAGADO_HI, NAGADO_LO = 37, 48, 47

for L in song.loops():
    at = lambda bar, beat=0: song.at(L, bar, beat)
    for bar in range(1, 17):
        c = CHORDS[(bar - 1) % 4]
        # 戰鼓踏步：1、3 拍；9 小節起 2、4 拍加排鼓
        for beat in (0, 2):
            kit.note(at(bar, beat), .3, DAGU, 92 + (8 if beat == 0 else 0) + (6 if bar >= 13 else 0))
        if bar >= 9 and bar != 16:
            for beat in (1, 3):
                kit.note(at(bar, beat), .25, PAIGU_HI, 78 if bar < 13 else 88)
        # 古箏分解和弦（13 小節起高八度的音加重）
        for i, p in enumerate(ARP[c]):
            gz.note(at(bar, i * .5), .48, p, (76 if i % 4 == 0 else 64) + (8 if bar >= 13 else 0))
        # 弦樂鋪底、低音
        st.chord(at(bar), 3.9, PAD[c], 58 if bar < 9 else 70)
        bs.note(at(bar), 1.9, ROOTB[c], 80)
        bs.note(at(bar, 2), 1.9, ROOTB[c], 74)
        # 琵琶：13 小節起反拍撥奏
        if bar >= 13 and bar != 16:
            for i in range(4):
                pipa.note(at(bar, i + .5), .4, ARP[c][3 + (i % 2)], 70)
    # 二胡主旋律（9–16 更用力）
    for bar, beat, beats, p in MEL:
        eh.note(at(bar, beat), beats - .08, p, 82 if bar < 9 else 92)
    # 銅管號角：9、11、13、15 小節的第一拍；13、15 第三拍再一記
    for bar in (9, 11, 13, 15):
        ch = CHORDS[(bar - 1) % 4]
        brass.chord(at(bar), 1.2, BRASS.get(ch, PAD[ch]), 96 if bar >= 13 else 88)
        if bar >= 13:
            brass.chord(at(bar, 2), .6, BRASS.get(ch, PAD[ch]), 86)
    # 太鼓重音、鈸、鑼
    for bar in (9, 13):
        taiko.note(at(bar), 1.5, ODAIKO, 110)
    kit.note(at(1), 2, DALUO, 64 if L == 0 else 78)
    kit.note(at(9), 2, SHUIBO, 88)
    kit.note(at(13), 2, DALUO, 96)
    # 第 16 小節過門：排鼓由高到低、最後一記大太鼓
    for i in range(12):
        kit.note(at(16, 1 + i * .25), .2, [PAIGU_HI, PAIGU_MID, PAIGU_LO][min(2, i // 4)], 78 + i * 3)
    taiko.note(at(16, 3.5), .5, NAGADO_LO, 104)


def instruments():
    import re
    from exs_render import Inst

    def erhu_release(sus_group, dur):
        m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
        string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
        long_ = "Long " if dur >= 0.8 else ""
        return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"

    return {
        "古箏": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked", release=0.6, max_len=2.5, pan=-0.2, reverb=0.4, gain_db=2),
        "二胡": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$", release=0.3,
                   pan=0.15, reverb=0.45, gain_db=-2, legato=0.15, release_group=erhu_release),
        "琵琶": Inst("Pipa.exs", "pluck", include=r"^(A High|A Low|D|E) Open", release=0.15, max_len=0.8,
                   pan=-0.3, reverb=0.3, gain_db=-3),
        "弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=0.6, pan=0.1, reverb=0.5, gain_db=-7),
        "低音弦樂": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=0.3, reverb=0.3, gain_db=-5),
        "銅管": Inst("09 Orchestral/02 Brass/Full Brass Staccato.exs", "pluck", exclude=r"Dummy", layer=lambda g: g.split("_")[0],
                   release=0.35, reverb=0.45, gain_db=-9),
        "太鼓": Inst("Japanese Traditional/Taiko Drums.exs", "oneshot", max_len=2.5, reverb=0.3, gain_db=-9),
        "中國鼓": Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", max_len=3, reverb=0.25, gain_db=-4),
    }


if __name__ == "__main__":
    song.main(instruments)
