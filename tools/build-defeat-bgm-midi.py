#!/usr/bin/env python3
"""敗亡（defeat）的循環配樂：舊兩人版在遊戲結束畫面播（四人版要補回來，播在哪裡整合時再定）。共用工具見 tools/bgm_midi.py。

    python3 tools/build-defeat-bgm-midi.py --render      ← 試聽（兩輪）
    python3 tools/build-defeat-bgm-midi.py --stems       ← 量各軌響度

原本 src/audio.js 的 buildDefeat：52 BPM、D 五聲小調的哀傷下行旋律（每兩拍一音，像古琴撥弦）、
D2 低沉持續音、慢顫音的弦樂墊（A3）、每四拍一次低音撥弦（A2 D2 F2 C2）、遠處戰場的低頻餘響。
  52 BPM，4/4，一輪 16 小節 ≈ 74 秒
   1– 8  古箏奏原本那段下行旋律（16 音、每兩拍一音），弦樂墊底
   9–16  二胡接手同一段，古箏低音撥弦加重；遠處一聲鐘
（亡國動畫有自己的配樂 assets/audio/fallen-bgm.*，跟這首無關）
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

song = Song("defeat", bpm=52, bars=16, key_sig=(-1, 1))     # D 小調

gz = song.track("古箏", program=107)
gzb = song.track("古箏低音", program=107)
eh = song.track("二胡", program=110)
st = song.track("弦樂墊", program=48)
bs = song.track("低音持續", program=43)
bell = song.track("遠鐘", program=14)
wind = song.track("戰場餘響", program=122)

MEL = ["D4", "C4", "A3", "G3", "F3", "D3", "F3", "G3", "A3", "G3", "F3", "D3", "C3", "D3", "F3", "G3"]   # 原本的旋律
BASS = ["A2", "D2", "F2", "C2"]                                                                         # 每四拍一音

for L in song.loops():
    at = lambda bar, beat=0: song.at(L, bar, beat)
    for i, p in enumerate(MEL):                       # 1–8：古箏（高一個八度才不會糊在低音裡）
        gz.note(at(1 + i // 2, (i % 2) * 2), 2, n(p) + 12, 80 if i % 2 == 0 else 70)
    for i, p in enumerate(MEL):                       # 9–16：二胡（同一個八度，最後一音拉長）
        dur = 1.9 if i < 15 else 3.6
        eh.note(at(9 + i // 2, (i % 2) * 2), dur, n(p) + 12, 76)
    for bar in range(1, 17):
        p = BASS[(bar - 1) % 4]
        gzb.note(at(bar), 3.5, p, 70 if bar >= 9 else 58)
    st.chord(at(1), 32 - .1, ("A3", "D4"), 52)
    st.chord(at(9), 16 - .1, ("F3", "A3", "D4"), 58)
    st.chord(at(13), 16 - .1, ("G3", "Bb3", "D4"), 58)
    bs.note(at(1), 64 - .1, "D2", 70)
    bell.note(at(9), 6, "D4", 64)
    bell.note(at(1), 6, "A3", 54 if L == 0 else 60)

wind.note(0, song.loop_count * song.loop_beats, "A3", 80)


def erhu_release(sus_group, dur):
    m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
    string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
    long_ = "Long " if dur >= 0.8 else ""
    return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"


def instruments():
    from exs_render import Inst, SynthBell, SynthWind
    return {
        "古箏": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked", release=2.0, max_len=5.0,
                   pan=-0.15, reverb=0.55, gain_db=6),
        "古箏低音": Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked", release=2.0, max_len=5.0,
                     pan=-0.35, reverb=0.5, gain_db=3),
        "二胡": Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$", release=0.6,
                   pan=0.15, reverb=0.6, gain_db=-1, legato=0.15, release_group=erhu_release),
        "弦樂墊": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.5, reverb=0.6, gain_db=-7),
        "低音持續": Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", release=1.5, reverb=0.4, gain_db=-10),
        "遠鐘": SynthBell(gain_db=-3, reverb=0.8),
        "戰場餘響": SynthWind(gain_db=-0.5, reverb=0.3),
    }


if __name__ == "__main__":
    song.main(instruments)
