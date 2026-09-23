#!/usr/bin/env python3
"""產生《一桌定江山》：30 秒開場動畫原創配樂。

只使用 numpy + Python 標準庫，輸出 44.1 kHz stereo WAV。
音樂時間點對齊 `開場動畫測試.html` 的六幕轉場。
"""
from pathlib import Path
import wave
import numpy as np

SR = 44_100
DURATION = 30.0
N = int(SR * DURATION)
OUT = Path(__file__).resolve().parents[1] / "assets" / "audio" / "intro-bgm.wav"
rng = np.random.default_rng(720)
mix = np.zeros((N, 2), dtype=np.float64)


def _place(sig, start, pan=0.0):
    """等響度左右聲道混音。"""
    i = max(0, int(start * SR))
    if i >= N:
        return
    sig = sig[:N - i]
    angle = (pan + 1.0) * np.pi / 4.0
    mix[i:i + len(sig), 0] += sig * np.cos(angle)
    mix[i:i + len(sig), 1] += sig * np.sin(angle)


def _env(length, attack=.01, release=.2, decay=None):
    t = np.arange(length) / SR
    e = np.ones(length)
    if attack:
        e *= np.minimum(1.0, t / attack)
    if decay:
        e *= np.exp(-t / decay)
    if release:
        tail = np.minimum(1.0, np.maximum(0.0, (length / SR - t) / release))
        e *= tail
    return e


def pad(start, dur, freqs, amp=.07, pan=0.0):
    """笙與低弦感的持續和聲。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for j, f in enumerate(freqs):
        phase = rng.uniform(0, np.pi * 2)
        vibrato = .0022 * np.sin(2 * np.pi * (3.1 + j * .17) * t)
        sig += np.sin(2 * np.pi * f * t + vibrato + phase)
        sig += .22 * np.sin(2 * np.pi * f * 2 * t + phase * .7)
    sig *= amp / max(1, len(freqs))
    sig *= _env(n, attack=1.1, release=1.4)
    _place(sig, start, pan)


def pluck(start, freq, dur=.72, amp=.18, pan=0.0):
    """古琴／箏撥弦：豐富泛音加指甲瞬態。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for h in range(1, 9):
        sig += (1 / h ** 1.25) * np.sin(2 * np.pi * freq * h * t + rng.uniform(-.12, .12))
    sig += rng.normal(0, 1, n) * np.exp(-t * 48) * .32
    sig *= np.exp(-t * 4.1) * _env(n, attack=.003, release=.06) * amp
    _place(sig, start, pan)


def brass(start, freq, dur=.8, amp=.12, pan=0.0):
    """戰角般的中低音銜管。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = sum(np.sin(2 * np.pi * freq * h * t) / h for h in range(1, 8))
    sig *= _env(n, attack=.045, release=.18) * amp
    _place(sig, start, pan)


def taiko(start, amp=.65, pan=0.0, low=42):
    """大鼓：快速降頻的鼓皮與短噌音。"""
    dur = .72
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = low + 128 * np.exp(-t * 18)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 7.2)
    skin = rng.normal(0, 1, n) * np.exp(-t * 34) * .18
    _place((body + skin) * amp, start, pan)


def rim(start, amp=.13, pan=0.0):
    n = int(.11 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    high = np.r_[noise[0], np.diff(noise)]
    sig = high * np.exp(-t * 44) * amp
    _place(sig, start, pan)


def gong(start, freq=73.42, amp=.24, pan=0.0, dur=4.2):
    """編鐘／銅鑼：不完全整數泛音產生金屬餘韻。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    partials = [(1, 1), (1.47, .58), (2.04, .36), (2.73, .21), (3.82, .12)]
    for ratio, level in partials:
        sig += level * np.sin(2 * np.pi * freq * ratio * t + rng.uniform(0, .25)) * np.exp(-t * (0.7 + ratio * .12))
    sig *= _env(n, attack=.008, release=.35) * amp
    _place(sig, start, pan)


# D 宮羽交錯的五聲音階：D F G A C。
D3, F3, G3, A3, C4 = 146.83, 174.61, 196.00, 220.00, 261.63
D4, F4, G4, A4, C5 = 293.66, 349.23, 392.00, 440.00, 523.25
D5, F5, G5, A5, C6, D6 = 587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66

# 0.0–4.3：亂世黑幕。只有土地低鳴、編鐘與疏落古琴。
pad(0, 9.1, [73.42, 110.0, D3], .12)
gong(.08, 73.42, .31, -.18, 4.6)
for t, f, p in [(.85, D4, -.35), (1.72, A4, .28), (2.62, G4, -.12), (3.48, C5, .34)]:
    pluck(t, f, .95, .16, p)

# 4.3–8.9：七雄一一現身；每張人物由一個鼓點承接。
lineup = [D4, F4, G4, A4, C5, A4, G4]
for i, f in enumerate(lineup):
    t = 4.34 + i * .56
    taiko(t, .38 if i else .58, (-.45 + i * .15))
    pluck(t + .06, f, .56, .12, (-.55 + i * .18))
rim(8.45, .2, .4)

# 8.9–14.2：四方對峙。戰鼓與戰角開始推進。
gong(8.82, D3, .26, .12, 3.5)
beat = 60 / 112
for i in range(10):
    t = 8.9 + i * beat
    taiko(t, .46 if i % 4 else .66, -.24 if i % 2 else .24)
    if i % 2:
        rim(t + beat * .5, .11, .48)
for i, f in enumerate([D3, D3, F3, G3, A3, G3, F3, D3]):
    brass(9.0 + i * beat * .72, f, .55, .105, (-.28 if i % 2 else .28))

# 14.2–20.3：「吃碰槓胡」四張牌落桌，速度與密度到最高。
pad(13.7, 7.5, [D3, A3, D4], .095)
for i, (label_t, f) in enumerate(zip([14.95, 15.23, 15.51, 15.79], [D4, F4, A4, D5])):
    taiko(label_t, .7, [-.55, -.18, .18, .55][i])
    gong(label_t, f, .075, [-.55, -.18, .18, .55][i], 1.3)
for i in range(14):
    t = 16.15 + i * .285
    taiko(t, .29 if i % 4 else .48, -.35 if i % 2 else .35, low=48)
    if i % 2:
        rim(t + .14, .085, .45)
for i, f in enumerate([D4, F4, G4, A4, C5, A4, G4, F4, D4, G4, A4, C5]):
    pluck(16.05 + i * .34, f, .4, .085, (-.42 + (i % 4) * .28))

# 20.3–25.3：征服主題。鼓點拉開，旋律上行轉為英雄感。
gong(20.22, D3, .3, -.12, 4.4)
for i in range(8):
    taiko(20.3 + i * .61, .52 if i % 4 == 0 else .33, -.25 if i % 2 else .25)
hero = [D4, F4, G4, A4, C5, A4, C5, D5, C5, A4]
for i, f in enumerate(hero):
    t = 20.42 + i * .46
    brass(t, f / 2, .7, .11, -.22 if i % 2 else .22)
    pluck(t + .035, f, .58, .11, .25 if i % 2 else -.25)

# 25.3–30.0：片名出現。轉為寬廣和聲，並以 D 的五度收束。
gong(25.22, 73.42, .38, 0, 4.7)
pad(25.18, 4.82, [D3, A3, D4, F4], .16)
for i, f in enumerate([D5, F5, G5, A5, C6, D6]):
    t = 25.45 + i * .52
    brass(t, f / 2, .86, .13, -.32 + i * .13)
    pluck(t + .04, f, .72, .105, .32 - i * .12)
taiko(28.55, .82, 0, low=36)
gong(28.58, D4, .19, .15, 1.42)
brass(28.62, D4, 1.28, .2, 0)
brass(28.64, A4, 1.22, .1, .12)

# 簡易空間殘響：較短的延遲保留動畫預告片的清晰度。
dry = mix.copy()
for delay, gain in [(.105, .16), (.219, .09), (.347, .055)]:
    d = int(delay * SR)
    mix[d:] += dry[:-d] * gain

# 首尾包線、去直流、柔限幅，留下一些動態給戰鼓。
master = np.ones(N)
master[:int(.08 * SR)] = np.linspace(0, 1, int(.08 * SR))
master[-int(1.08 * SR):] = np.linspace(1, 0, int(1.08 * SR))
mix *= master[:, None]
mix -= np.mean(mix, axis=0, keepdims=True)
mix = np.tanh(mix * 1.18)
peak = np.max(np.abs(mix))
mix *= .92 / max(peak, 1e-9)

OUT.parent.mkdir(parents=True, exist_ok=True)
pcm = (mix * 32767).astype('<i2')
with wave.open(str(OUT), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SR)
    wav.writeframes(pcm.tobytes())
print(OUT)
