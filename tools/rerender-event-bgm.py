#!/usr/bin/env python3
"""開場序章、統一天下、亡國這三段動畫配樂：同一份 MIDI（音符、時間點不動），改用 GarageBand 的取樣演奏。

    python3 tools/rerender-event-bgm.py            ← 三首都做，輸出 assets/audio/<名>-bgm.mp3（遊戲直接用）
    python3 tools/rerender-event-bgm.py fallen     ← 只做一首

為什麼（2026-10-16）：這三首當初是 fluidsynth＋GM 音色庫轉的；使用者決定所有 BGM 升級、而且音量要一致
（開場那首原本 -21.9 LUFS，比其他首小約 6 dB）。時間點跟動畫綁在一起（src/intro.js、unify.js、fallen.js），
所以只換音色、不改音符；長度與結尾淡出照 tools/render-bgm.sh（長度＋0.2 秒起淡出 1.2 秒）。
2026-10-16 使用者試聽後定案，v1.70 起取代原本 fluidsynth 那一版。

鍵位：舊 MIDI 是照 GM 寫的 —— 鼓組 52（中國鈸）對到 Chinese Kit 的水鈸 42；定音鼓有音高、GarageBand 沒有，
依音域對到太鼓（低→大太鼓、中→長胴）；塤沒有，用長笛的低音域代替（都是氣聲重的吹管）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exs_render import Inst, SynthBell, SynthWind, render, to_mp3, stem_loudness

AUDIO = Path(__file__).resolve().parents[1] / "assets" / "audio"


def kit(**k):
    return Inst("Chinese Kit.exs", "oneshot", exclude=r"Off|Rub|Rattle",
                **{"keymap": {52: 42, 50: 49, 51: 49, 57: 49}, "max_len": 4, "reverb": 0.35, **k})


def timpani(**k):
    # 定音鼓（有音高）→ 太鼓：低音 → 大太鼓（37），中音 → 長胴（47／48）
    return Inst("Japanese Traditional/Taiko Drums.exs", "oneshot",
                keymap=lambda key: 37 if key < 40 else (47 if key < 46 else 48), **{"max_len": 3, "reverb": 0.4, **k})


def guzheng(**k):
    return Inst("Chinese Traditional/Guzheng.exs", "pluck", include=r"^Main Notes Plucked", **{"release": 1.2, "max_len": 4, **k})


def strings(**k):
    return Inst("09 Orchestral/09 Strings/String Ensemble.exs", "sustain", **{"release": 0.8, "reverb": 0.5, **k})


def brass(**k):
    return Inst("09 Orchestral/02 Brass/Full Brass+.exs", "sustain", include=r"^Legato:",
                layer=lambda g: g.split(":")[1].strip(), **{"release": 0.4, "reverb": 0.45, **k})


SONGS = {
    "intro": (30.0, lambda: {
        "古箏／撥弦": guzheng(pan=-0.2, reverb=0.45, gain_db=5),
        "戰鼓／打擊": kit(gain_db=-2),
        "編鐘／金屬餘韻": SynthBell(gain_db=-10, reverb=0.6),
        "戰角銜管": brass(gain_db=-4.2),
        "弦樂長音": strings(gain_db=-5),
        "低音地鳴": strings(reverb=0.35, gain_db=-9.4),
        "定音鼓": timpani(gain_db=-9.3),
    }),
    "unify": (24.0, lambda: {
        "古箏／撥弦": guzheng(pan=-0.2, reverb=0.45, gain_db=4),
        "戰鼓": kit(gain_db=-3.1),
        "編鐘": SynthBell(gain_db=-11.8, reverb=0.6),
        "號角銅管": brass(gain_db=-4.7),
        "弦樂長音": strings(gain_db=-5.5),
        "低音": strings(reverb=0.35, gain_db=-7.7),
        "定音鼓": timpani(gain_db=-9.4),
        "銅鑼": kit(gain_db=0, max_len=6),
    }),
    "fallen": (14.0, lambda: {
        "塤（Ocarina 代）": Inst("09 Orchestral/01 Woodwinds/Flute Solo Legato.exs", "sustain", release=0.6,
                               reverb=0.6, gain_db=-1.3),
        "古箏": guzheng(pan=-0.25, reverb=0.5, gain_db=5.3),
        "編鐘": SynthBell(gain_db=-4.5, reverb=0.7),
        "低音弦樂": strings(reverb=0.5, gain_db=-4),
        "低音": strings(reverb=0.35, gain_db=-4.3),
        "定音鼓": timpani(gain_db=-9),
        "大鑼（Taiko 代）": kit(gain_db=2, max_len=6, keymap={33: 49}),
        "風聲": SynthWind(gain_db=6, reverb=0.2),
        "戰鼓": kit(gain_db=-7.5),
    }),
}

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in SONGS] or list(SONGS)
    for name in names:
        length, inst = SONGS[name]
        mid = AUDIO / f"{name}-bgm.mid"
        print(f"══ {name}（{length:.0f} 秒）══")
        if "--stems" in sys.argv:
            for k, v in stem_loudness(mid, inst(), seconds=length).items():
                print(f"  {k:24s} {v:6.1f} LUFS")
            continue
        wav = AUDIO / f"{name}-bgm.tmp.wav"
        render(mid, inst(), wav, total_seconds=length + 1.5)
        to_mp3(wav, AUDIO / f"{name}-bgm.mp3", fade=(length + 0.2, 1.2))
        wav.unlink()
        print(AUDIO / f"{name}-bgm.mp3")
