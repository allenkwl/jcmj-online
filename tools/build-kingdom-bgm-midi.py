#!/usr/bin/env python3
"""七國專屬曲（qi chu yan han wei zhao qin）。共用工具見 tools/bgm_midi.py。

    python3 tools/build-kingdom-bgm-midi.py qin --render     ← 一國的試聽（兩輪）
    python3 tools/build-kingdom-bgm-midi.py all --render     ← 七國全部
    python3 tools/build-kingdom-bgm-midi.py qin --stems      ← 量各軌響度

舊兩人版在對局時播「對手那一國」的曲子；四人版使用者定（2026-10-16）：**誰是東（莊家）就播那一國的曲**。
每一國的個性照原本 src/audio.js 的 buildKingdom_*（註解、音列、速度都沿用），換成真樂器：
  齊  東方大國、富庶：悠揚五聲（D E G A B 商調）、水波感、從容 —— 古箏流水、水聲、琵琶點綴
  楚  南方霸主：深沉低音、強烈節拍（鼓：0、半拍、一拍半）、G 小調五聲 riff —— 排鼓、琵琶、低音
  燕  北境寒地、奇謀：蕭瑟寒風、神秘（F A C♯ E A 的懸浮和聲）、不規則的零星撥弦 —— 冷調弦樂、寒風、古箏泛音
  韓  兵器精良、守城：金屬感、穩健行軍（112 BPM、A 小調）—— 行軍鼓、琵琶＋銅管
  魏  中原要衝、四戰之地：激烈衝突（130 BPM、D 弗里吉亞）—— 快速八分音符、二胡＋琵琶、太鼓
  趙  騎射天下第一：奔騰（三連音馬蹄）、開闊（E 大調、空五度）—— 馬蹄鼓、二胡英雄旋律
  秦  虎狼之師、六合必歸：帝王威嚴、重低音（95 BPM、C 大調銅管）—— 大太鼓、銅管、大鑼
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bgm_midi import Song, n

# Chinese Kit／Taiko 的鍵位（讀 .exs 對出來的，見 build-select-bgm-midi.py 的註解）
DAGU, PAIGU = 36, [48, 47, 45, 43, 41]           # 大鼓；排鼓 高→低
DALUO, SHUIBO, XIAOBO, XIAOLUO, BANGZI = 49, 42, 54, 55, 24
ODAIKO, OKEDO, NAGADO_HI, NAGADO_LO, SUMO = 37, 38, 48, 47, 50


def erhu_release(sus_group, dur):
    m = re.match(r"Sus (A|D|GB) \w+ rr\d (?:Trim )?([ABC])?", sus_group)
    string, layer = (m.group(1), m.group(2) or "A") if m else ("A", "A")
    long_ = "Long " if dur >= 0.8 else ""
    return f"^Rel {long_}{string}$" if string == "GB" else f"^Rel {long_}{string} {layer}$"


def I():
    """樂器工廠（延遲 import：只寫 MIDI 時不用載取樣）"""
    from exs_render import Inst, SynthWind, SynthBell
    class F:
        guzheng = staticmethod(lambda **k: Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked",
                                                **{"release": 1.0, "max_len": 4.0, **k}))
        harmonics = staticmethod(lambda **k: Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Harmonics",
                                                  **{"release": 1.5, "max_len": 4.0, **k}))
        pipa = staticmethod(lambda **k: Inst("Pipa.exs", "pluck", include=r"^(A High|A Low|D|E) Open",
                                             **{"release": 0.6, "max_len": 2.5, **k}))
        erhu = staticmethod(lambda **k: Inst("Erhu.exs", "sustain", include=r"^Sus (A|D|GB) (Up|Down) rr[12] A$",
                                             **{"release": 0.35, "legato": 0.15, "release_group": erhu_release, **k}))
        strings = staticmethod(lambda **k: Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain",
                                                **{"release": 0.8, **k}))
        brass = staticmethod(lambda **k: Inst("09 Orchestral/02 Brass/Full Brass+.exs", "sustain", include=r"^Legato:",
                                              layer=lambda g: g.split(":")[1].strip(), **{"release": 0.4, **k}))
        brass_stac = staticmethod(lambda **k: Inst("09 Orchestral/02 Brass/Full Brass Staccato.exs", "pluck",
                                                   exclude=r"Dummy", layer=lambda g: g.split("_")[0], **{"release": 0.3, **k}))
        kit = staticmethod(lambda **k: Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle", **{"max_len": 3, **k}))
        taiko = staticmethod(lambda **k: Inst("Japanese Traditional/Taiko Drums.exs", "oneshot", **{"max_len": 3, **k}))
        wind = staticmethod(lambda **k: SynthWind(**k))
        bell = staticmethod(lambda **k: SynthBell(**k))
    return F


def melody(track, at, notes, vel, gap=0.0):
    """notes：[(小節, 拍, 長, 音)]"""
    for bar, beat, dur, p in notes:
        track.note(at(bar, beat), max(.1, dur - gap), p, vel)


# ───────────────────────── 齊 ─────────────────────────
def qi():
    s = Song("kingdom-qi", scene="qi", bpm=84, bars=16, key_sig=(1, 0))
    gz, gzb, pp, st, bs, water = (s.track("古箏", 107), s.track("古箏伴奏", 107), s.track("琵琶", 105),
                                  s.track("弦樂", 48), s.track("低音弦樂", 43), s.track("水聲", 122))
    PENTA = ["D4", "E4", "G4", "A4", "B4", "D5", "E5", "D5", "B4", "A4", "G4", "E4", "D4", "E4"]   # 原本的音列
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        # 1–8：古箏流水（原本每 0.7 秒一個音 ≈ 這裡每拍一個），兩輪音列 + 尾音
        seq = PENTA + PENTA + ["D4", "A3"]
        for i, p in enumerate(seq[:30]):
            gz.note(at(1 + i // 4, i % 4), 1, p, 80 if i % 4 == 0 else 70)
        # 9–16：古箏換成較疏的句子，琵琶應答
        A = [(9, 0, 1.5, "B4"), (9, 1.5, .5, "A4"), (9, 2, 2, "G4"), (10, 0, 1, "E4"), (10, 1, 1, "G4"), (10, 2, 2, "A4"),
             (11, 0, 1, "D5"), (11, 1, 1, "B4"), (11, 2, 1, "A4"), (11, 3, 1, "G4"), (12, 0, 3.5, "A4"),
             (13, 0, 1.5, "E5"), (13, 1.5, .5, "D5"), (13, 2, 2, "B4"), (14, 0, 1, "A4"), (14, 1, 1, "B4"), (14, 2, 2, "D5"),
             (15, 0, 1, "B4"), (15, 1, 1, "A4"), (15, 2, 1, "G4"), (15, 3, 1, "E4"), (16, 0, 3.5, "D4")]
        melody(gz, at, A, 82)
        P = [(10, 3, .5, "D5"), (10, 3.5, .5, "E5"), (12, 2, .5, "B4"), (12, 2.5, .5, "D5"), (12, 3, 1, "E5"),
             (14, 3, .5, "G5"), (14, 3.5, .5, "E5"), (16, 2, .5, "A4"), (16, 2.5, .5, "B4"), (16, 3, 1, "D5")]
        melody(pp, at, P, 74)
        for bar in range(1, 17):            # 伴奏：根－五 每兩拍
            r = n("D3") if bar not in (5, 6, 13, 14) else n("G3")
            gzb.note(at(bar, 0), 1.8, r, 60)
            gzb.note(at(bar, 2), 1.8, r + 7, 52)
        st.chord(at(1), 16 - .1, ("D3", "A3"), 56); st.chord(at(5), 8 - .1, ("G3", "D4"), 56)
        st.chord(at(9), 16 - .1, ("D3", "A3", "E4"), 60); st.chord(at(13), 16 - .1, ("D3", "A3", "D4"), 62)
        bs.note(at(1), 64 - .1, "D2", 64)
    water.note(0, s.loop_count * s.loop_beats, "C6", 80)
    F = None

    def inst():
        F = I()
        return {"古箏": F.guzheng(pan=-0.2, reverb=0.5, gain_db=6), "古箏伴奏": F.guzheng(pan=-0.45, reverb=0.4, gain_db=1),
                "琵琶": F.pipa(pan=0.35, reverb=0.45, gain_db=-6), "弦樂": F.strings(reverb=0.5, gain_db=-8),
                "低音弦樂": F.strings(reverb=0.35, gain_db=-11), "水聲": F.wind(gain_db=-4, reverb=0.3)}
    return s, inst


# ───────────────────────── 楚 ─────────────────────────
def chu():
    s = Song("kingdom-chu", scene="chu", bpm=105, bars=16, key_sig=(-2, 1))
    pp, eh, bs, st, kit, tk = (s.track("琵琶", 105), s.track("二胡", 110), s.track("低音弦樂", 43),
                               s.track("弦樂", 48), s.track("中國鼓", drums=True), s.track("太鼓", 116))
    RIFF = ["G3", "A3", "C4", "D4", "F4", "D4", "C4", "A3", "G3", "F3", "G3", "A3"]   # 原本的南呂調 riff（每拍一個）
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        for bar in range(1, 17):
            for off, drum, v in [(0, PAIGU[4], 104), (.5, PAIGU[2], 80), (1.5, PAIGU[3], 92),
                                 (2, PAIGU[4], 100), (2.5, PAIGU[2], 78), (3.5, PAIGU[3], 90)]:
                kit.note(at(bar, off), .3, drum, v)
            kit.note(at(bar, 0), .3, DAGU, 100)
            if bar >= 9:
                tk.note(at(bar, 0), 1, ODAIKO, 96)
                tk.note(at(bar, 2), 1, OKEDO, 84)
            bs.note(at(bar, 0), 1.8, "G1" if bar % 4 else "F1", 90)
            bs.note(at(bar, 2), 1.8, "G1" if bar % 4 else "F1", 76)
        for i in range(48):                  # 琵琶 riff：12 拍一輪，1–12 小節走四輪
            pp.note(at(1 + i // 4, i % 4), .9, RIFF[i % 12], 84 if i % 12 == 0 else 72)
        # 13–16：琵琶高八度、二胡接手主題
        for i in range(16):
            pp.note(at(13 + i // 4, i % 4), .9, n(RIFF[i % 12]) + 12, 78)
        E = [(9, 0, 2, "D5"), (9, 2, 2, "C5"), (10, 0, 3, "A4"), (11, 0, 2, "F5"), (11, 2, 2, "D5"), (12, 0, 3.5, "G4"),
             (13, 0, 2, "Bb4"), (13, 2, 2, "C5"), (14, 0, 3, "D5"), (15, 0, 1, "F5"), (15, 1, 1, "D5"), (15, 2, 2, "C5"),
             (16, 0, 3.5, "G4")]
        melody(eh, at, E, 88, gap=.08)
        st.chord(at(9), 32 - .1, ("G2", "D3", "Bb3"), 62)
        kit.note(at(1), 2, DALUO, 80 if L else 64)
        kit.note(at(9), 2, DALUO, 92)

    def inst():
        F = I()
        return {"琵琶": F.pipa(pan=-0.25, reverb=0.35, gain_db=-0.5), "二胡": F.erhu(pan=0.2, reverb=0.4, gain_db=-2),
                "低音弦樂": F.strings(release=0.3, reverb=0.25, gain_db=-4), "弦樂": F.strings(reverb=0.45, gain_db=-8),
                "中國鼓": F.kit(reverb=0.3, gain_db=-2.5), "太鼓": F.taiko(reverb=0.3, gain_db=-9)}
    return s, inst


# ───────────────────────── 燕 ─────────────────────────
def yan():
    s = Song("kingdom-yan", scene="yan", bpm=60, bars=16, key_sig=(3, 0))
    st, st2, gzh, gz, eh, wind, kit = (s.track("弦樂（冷）", 48), s.track("弦樂高音", 48), s.track("古箏泛音", 107),
                                       s.track("古箏", 107), s.track("二胡", 110), s.track("寒風", 122),
                                       s.track("中國鼓", drums=True))
    SPARSE = ["C#4", "D#4", "F#4", "G#4", "C#4", "F#4", "D#4", "G#4", "E4", "C#4"]   # 原本零星撥弦的音列
    # 「不規則」：每小節出現的拍點（固定下來，不用亂數 —— 每輪都一樣）
    HITS = [(1, 1.5), (2, 0), (2, 2.75), (3, 1), (4, 0.5), (4, 3), (5, 2), (6, 0), (6, 1.5), (7, 3.25),
            (8, 1), (9, 0), (9, 2.5), (10, 1.75), (11, 0.5), (12, 2), (13, 0), (13, 3), (14, 1.25), (15, 2.5), (16, 0.75)]
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        # 懸浮和聲（原本 F A C♯ E A 的 pad）
        st.chord(at(1), 32 - .1, ("F2", "A2", "C#3", "E3"), 58)
        st.chord(at(9), 16 - .1, ("D2", "A2", "C#3", "F#3"), 60)
        st.chord(at(13), 16 - .1, ("F2", "A2", "C#3", "E3"), 58)
        st2.note(at(5), 12 - .1, "A4", 50); st2.note(at(13), 16 - .1, "G#4", 52)
        for i, (bar, beat) in enumerate(HITS):
            (gzh if i % 3 == 0 else gz).note(at(bar, beat), 2, SPARSE[i % len(SPARSE)], 70 if i % 3 else 78)
        E = [(9, 0, 4, "C#5"), (10, 0, 2, "D#5"), (10, 2, 2, "F#5"), (11, 0, 4, "E5"), (12, 0, 3.5, "C#5")]
        melody(eh, at, E, 70, gap=.1)
        kit.note(at(1), 3, SHUIBO, 52); kit.note(at(9), 3, DALUO, 56)
    wind.note(0, s.loop_count * s.loop_beats, "A5", 100)

    def inst():
        F = I()
        return {"弦樂（冷）": F.strings(release=1.5, reverb=0.6, gain_db=-10), "弦樂高音": F.strings(release=1.5, reverb=0.6, gain_db=-1.5),
                "古箏泛音": F.harmonics(pan=0.35, reverb=0.7, gain_db=10), "古箏": F.guzheng(pan=-0.3, reverb=0.6, gain_db=7.5),
                "二胡": F.erhu(pan=0.1, reverb=0.6, gain_db=-3), "寒風": F.wind(gain_db=1.5, reverb=0.2),
                "中國鼓": F.kit(reverb=0.6, gain_db=12, max_len=5)}
    return s, inst


# ───────────────────────── 韓 ─────────────────────────
def han():
    s = Song("kingdom-han", scene="han", bpm=112, bars=16, key_sig=(0, 1))
    pp, brass, st, bs, kit = (s.track("琵琶", 105), s.track("銅管", 61), s.track("弦樂", 48), s.track("低音弦樂", 43),
                              s.track("行軍鼓", drums=True))
    MEL = ["A4", "B4", "C5", "A4", "G4", "A4", "F4", "G4", "A4", "B4", "A4", "G4"]   # 原本的金屬感旋律（每拍一個）
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        for bar in range(1, 17):
            for beat in range(4):
                kit.note(at(bar, beat), .3, DAGU, 92 if beat in (0, 2) else 76)            # 大鼓每拍（原本 kick 每拍）
            for beat in (1, 3):
                kit.note(at(bar, beat), .3, PAIGU[0], 90)                                     # 行軍小鼓（原本每兩拍）
            if bar % 2 == 0:
                kit.note(at(bar, 3.5), .2, PAIGU[1], 72)
            bs.note(at(bar, 0), 1.8, "A1" if bar % 4 not in (3,) else "F1", 82)
            bs.note(at(bar, 2), 1.8, "E2" if bar % 4 not in (3,) else "C2", 74)
        for i in range(48):
            pp.note(at(1 + i // 4, i % 4), .85, MEL[i % 12], 82 if i % 4 == 0 else 72)
        for i in range(16):                  # 13–16：銅管齊奏旋律
            brass.note(at(13 + i // 4, i % 4), .85, MEL[i % 12], 84)
            pp.note(at(13 + i // 4, i % 4), .85, n(MEL[i % 12]) + 12, 70)
        for bar in (5, 7, 9, 11):
            brass.chord(at(bar), 1.5, ("A2", "E3", "A3"), 86)
        st.chord(at(9), 16 - .1, ("A2", "E3", "C4"), 60)
        st.chord(at(13), 16 - .1, ("F2", "C3", "A3"), 64)
        kit.note(at(1), 2, SHUIBO, 76)

    def inst():
        F = I()
        return {"琵琶": F.pipa(pan=-0.25, release=0.3, reverb=0.3, gain_db=-1.5),
                "銅管": F.brass(pan=0.15, reverb=0.4, gain_db=-6.5), "弦樂": F.strings(reverb=0.4, gain_db=-9.5),
                "低音弦樂": F.strings(release=0.3, reverb=0.25, gain_db=-5), "行軍鼓": F.kit(reverb=0.3, gain_db=-3.5)}
    return s, inst


# ───────────────────────── 魏 ─────────────────────────
def wei():
    s = Song("kingdom-wei", scene="wei", bpm=130, bars=24, key_sig=(-1, 1))
    pp, eh, st, bs, kit, tk = (s.track("琵琶", 105), s.track("二胡", 110), s.track("弦樂", 48), s.track("低音弦樂", 43),
                               s.track("中國鼓", drums=True), s.track("太鼓", 116))
    RIFF = ["D5", "C#5", "C5", "D5", "Eb5", "D5", "C5", "B4", "C5", "D5", "C#5", "C5"]   # 原本的 D 弗里吉亞 riff（八分音符）
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        for bar in range(1, 25):
            for beat in range(4):
                kit.note(at(bar, beat), .25, DAGU, 98 if beat == 0 else 84)                  # 原本 kick 每拍
            if bar >= 5:
                for beat in (1, 3):
                    kit.note(at(bar, beat), .25, PAIGU[0], 92)
            if bar >= 13:
                for i in range(8):
                    tk.note(at(bar, i * .5), .4, NAGADO_HI if i % 2 else NAGADO_LO, 70 + (16 if i % 4 == 0 else 0))
            bs.note(at(bar, 0), .9, "D2", 94); bs.note(at(bar, 1.5), .9, "D2", 80)
            bs.note(at(bar, 2), .9, "Eb2" if bar % 2 else "D2", 88); bs.note(at(bar, 3.5), .4, "C2", 76)
        for i in range(24 * 8):              # 琵琶 riff 一路八分音符（17–20 停四小節換二胡獨奏）
            bar = 1 + i // 8
            if 17 <= bar <= 20:
                continue
            pp.note(at(bar, (i % 8) * .5), .45, RIFF[i % 12], 82 if i % 4 == 0 else 70)
        E = [(9, 0, 2, "D5"), (9, 2, 2, "Eb5"), (10, 0, 4, "D5"), (11, 0, 2, "F5"), (11, 2, 2, "Eb5"), (12, 0, 4, "D5"),
             (17, 0, 1, "A5"), (17, 1, 1, "G5"), (17, 2, 2, "F5"), (18, 0, 1, "Eb5"), (18, 1, 1, "D5"), (18, 2, 2, "C5"),
             (19, 0, 1, "D5"), (19, 1, 1, "Eb5"), (19, 2, 2, "F5"), (20, 0, 4, "D5"),
             (21, 0, 4, "D6"), (22, 0, 4, "C6"), (23, 0, 4, "Bb5"), (24, 0, 3.5, "A5")]
        melody(eh, at, E, 92, gap=.08)
        st.chord(at(13), 16 - .1, ("D3", "A3", "D4"), 66); st.chord(at(17), 32 - .1, ("D3", "Eb3", "A3"), 70)
        kit.note(at(1), 2, DALUO, 84); kit.note(at(13), 2, DALUO, 100); kit.note(at(21), 2, SHUIBO, 96)

    def inst():
        F = I()
        return {"琵琶": F.pipa(pan=-0.25, release=0.2, reverb=0.3, gain_db=-3.7), "二胡": F.erhu(pan=0.2, reverb=0.4, gain_db=0),
                "弦樂": F.strings(reverb=0.45, gain_db=-9.5), "低音弦樂": F.strings(release=0.2, reverb=0.25, gain_db=-3),
                "中國鼓": F.kit(reverb=0.3, gain_db=-2), "太鼓": F.taiko(reverb=0.3, gain_db=-10)}
    return s, inst


# ───────────────────────── 趙 ─────────────────────────
def zhao():
    s = Song("kingdom-zhao", scene="zhao", bpm=120, bars=24, key_sig=(4, 0))
    eh, pp, brass, st, bs, kit, tk = (s.track("二胡", 110), s.track("琵琶", 105), s.track("銅管", 61), s.track("弦樂", 48),
                                      s.track("低音弦樂（空五度）", 43), s.track("中國鼓", drums=True), s.track("太鼓（馬蹄）", 116))
    HERO = ["E4", "F#4", "G#4", "A4", "B4", "C#5", "B4", "A4", "G#4", "F#4", "E4", "D4", "E4", "F#4"]   # 原本的英雄旋律（每拍）
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        for bar in range(1, 25):
            for beat in range(4):            # 馬蹄：每拍三連音（原本 gallop）
                for j, v in enumerate((96, 66, 74)):
                    tk.note(at(bar, beat + j / 3), .3, NAGADO_LO if j == 0 else NAGADO_HI, v)
            kit.note(at(bar, 0), .3, DAGU, 96)
            kit.note(at(bar, 2), .3, DAGU, 84)
        # 1–8 琵琶奏英雄旋律（每拍一個，14 拍一輪）、9–16 二胡、17–24 二胡高八度＋銅管
        for i in range(32):
            pp.note(at(1 + i // 4, i % 4), .9, HERO[i % 14], 80 if i % 4 == 0 else 70)
        for i in range(32):
            eh.note(at(9 + i // 4, i % 4), .92, HERO[i % 14], 88)
        for i in range(30):
            eh.note(at(17 + i // 4, i % 4), .92, n(HERO[i % 14]) + 12, 94)
        eh.note(at(24, 2), 1.9, "E5", 94)
        for bar in (17, 19, 21, 23):
            brass.chord(at(bar), 3.8, ("E3", "B3", "E4"), 78)
        bs.chord(at(1), 96 - .1, ("E2", "B2"), 70)                       # 原本的空五度 E2–B2
        st.chord(at(9), 32 - .1, ("E3", "B3", "G#4"), 60); st.chord(at(17), 32 - .1, ("A2", "E3", "C#4"), 64)
        kit.note(at(1), 2, DALUO, 80); kit.note(at(17), 2, DALUO, 96)

    def inst():
        F = I()
        return {"二胡": F.erhu(pan=0.15, reverb=0.4, gain_db=0), "琵琶": F.pipa(pan=-0.3, reverb=0.4, gain_db=-1),
                "銅管": F.brass(reverb=0.45, gain_db=-9), "弦樂": F.strings(reverb=0.5, gain_db=-8),
                "低音弦樂（空五度）": F.strings(reverb=0.35, gain_db=-10), "中國鼓": F.kit(reverb=0.3, gain_db=-6),
                "太鼓（馬蹄）": F.taiko(reverb=0.25, gain_db=-12.5)}
    return s, inst


# ───────────────────────── 秦 ─────────────────────────
def qin():
    s = Song("kingdom-qin", scene="qin", bpm=95, bars=16, key_sig=(0, 0))
    brass, st, bs, eh, tk, kit, bell = (s.track("銅管（帝王）", 61), s.track("弦樂", 48), s.track("低音弦樂", 43),
                                        s.track("二胡", 110), s.track("大太鼓", 116), s.track("中國鼓", drums=True),
                                        s.track("編鐘", 14))
    BRASS = ["C4", "D4", "E4", "F4", "G4", "A4", "G4", "F4", "E4", "D4", "C4", "B3", "C4", "D4"]   # 原本的帝王銅管（每兩拍）
    for L in s.loops():
        at = lambda bar, beat=0: s.at(L, bar, beat)
        for bar in range(1, 17):
            tk.note(at(bar, 0), 1.5, ODAIKO, 112)                # 原本每兩拍一記大鼓
            tk.note(at(bar, 2), 1.5, ODAIKO, 98)
            if bar >= 9:
                kit.note(at(bar, 1), .3, DAGU, 74); kit.note(at(bar, 3), .3, DAGU, 74)
                kit.note(at(bar, 3.5), .3, DAGU, 64)
        for i in range(28):                  # 銅管：每兩拍一音，14 音一輪 → 1–14 小節走完；15–16 收在 C
            brass.note(at(1 + i // 2, (i % 2) * 2), 1.9, BRASS[i % 14], 88 if i % 2 == 0 else 80)
        brass.chord(at(15), 7.8, ("C3", "G3", "C4", "E4"), 92)
        E = [(9, 0, 4, "G5"), (10, 0, 2, "A5"), (10, 2, 2, "G5"), (11, 0, 4, "E5"), (12, 0, 4, "D5"),
             (13, 0, 2, "E5"), (13, 2, 2, "G5"), (14, 0, 4, "C6"), (15, 0, 4, "B5"), (16, 0, 3.5, "C6")]
        melody(eh, at, E, 82, gap=.1)
        st.chord(at(1), 32 - .1, ("C3", "G3", "E4"), 64); st.chord(at(9), 16 - .1, ("F3", "C4", "A4"), 68)
        st.chord(at(13), 16 - .1, ("G3", "D4", "B4"), 70)
        bs.chord(at(1), 64 - .1, ("C2", "G2"), 74)                          # 原本的 C2–G2 pad
        kit.note(at(1), 3, DALUO, 92); kit.note(at(9), 3, DALUO, 100)
        for bar in (1, 5, 9, 13):
            bell.note(at(bar), 6, "C4", 80)

    def inst():
        F = I()
        return {"銅管（帝王）": F.brass(pan=-0.1, reverb=0.5, gain_db=-4), "弦樂": F.strings(reverb=0.5, gain_db=-7),
                "低音弦樂": F.strings(reverb=0.35, gain_db=-10), "二胡": F.erhu(pan=0.25, reverb=0.5, gain_db=-1),
                "大太鼓": F.taiko(reverb=0.4, gain_db=-9.5), "中國鼓": F.kit(reverb=0.35, gain_db=-1.5),
                "編鐘": F.bell(gain_db=-4.3, reverb=0.6)}
    return s, inst


ALL = {"qi": qi, "chu": chu, "yan": yan, "han": han, "wei": wei, "zhao": zhao, "qin": qin}

if __name__ == "__main__":
    which = [a for a in sys.argv[1:] if a in ALL or a == "all"]
    if not which:
        sys.exit("要指定國：" + " ".join(ALL) + " 或 all")
    ids = list(ALL) if "all" in which else which
    for k in ids:
        print(f"══ {k} ══")
        song, inst = ALL[k]()
        song.main(inst)
