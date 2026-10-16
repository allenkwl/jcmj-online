#!/usr/bin/env python3
"""MIDI → WAV：直接拿 GarageBand／Logic 下載下來的取樣（.exs 樂器）照 MIDI 演奏，不用開 GarageBand。

為什麼（2026-10-16）：BGM 改成 MIDI，音色要比 fluidsynth 的 GM 音色庫好 —— GarageBand 有古箏、二胡、中國鼓、太鼓、
管弦樂取樣。但用腳本操作 GarageBand 的畫面會搶滑鼠，使用者正在用電腦、另一個 Claude 也在用 GarageBand，
所以改成自己讀 .exs、自己切取樣演奏。音色跟 GarageBand 是同一批取樣；差在 GarageBand 會替拉弦樂器做
連音、揉弦、力度層漸變，這裡是簡化版（音一個一個獨立發聲）。

用法（給 tools/build-*-bgm-midi.py 呼叫）：
    from exs_render import render
    render(midi_path, {軌名: Inst(...)}, out_wav, loop_seconds=…)

── .exs 格式（欄位位置照 ConvertWithMoss 的 EXS 解析，並用實際檔案核對過）──
  每個 chunk：前 84 bytes 是表頭（sig、size、…、名稱在 20–84），型別在 sig 的第 25–28 位元：1 zone、2 group、3 sample
  zone：85 根音、86 微調、88 音量(dB)、90–91 鍵域、93–94 力度範圍、96 起點、100 終點、104/108 循環起訖、117 循環開關、
        164 粗調、172 群組、176 取樣
  ⚠️ consolidated 的樂器（古箏、二胡…）把所有取樣接成一個 .caf，zone 的起訖是在那個大檔裡的位置。
     二胡的循環段落在「終點」**之後**（起音和持續段分開存）→ 有循環的 zone 一律播 起點→循環終點，再在循環段裡繞。
  ⚠️ .caf 是 AAC 壓縮的，先用 afconvert 解成 WAV（快取在 ~/Library/Caches/jcmj-exs/）。

── 群組（演奏法）怎麼挑 ──
  同一個鍵常常有好幾個群組：輪替取樣（rr1/rr2、-01/-02）、放開琴鍵才響的（Rel、Off）、不同演奏法（顫音、滑音）。
  GarageBand 是靠鍵切換或控制器選的；這裡每個樂器用名稱的 include／exclude 正規表示式挑，
  剩下的候選裡取「根音離得最近」的（音高拉得少、音色最自然），同分的輪流用（輪替取樣）。
"""
import os
import re
import struct
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
CACHE = Path.home() / "Library" / "Caches" / "jcmj-exs"
GB = "/Library/Application Support/GarageBand/Instrument Library/Sampler/Sampler Instruments/"
LOGIC = "/Library/Application Support/Logic/Sampler Instruments/"


# ───────────────────────── .exs ─────────────────────────
def _s8(b):
    return b - 256 if b > 127 else b


def parse_exs(path):
    d = open(path, "rb").read()
    i = 0
    zones, groups, samples = [], [], []
    while i + 84 <= len(d):
        sig, size = struct.unpack("<II", d[i:i + 8])
        typ = (sig >> 24) & 0xF
        name = d[i + 20:i + 84].split(b"\0")[0].decode("utf-8", "replace")
        I = lambda o: struct.unpack("<i", d[i + o:i + o + 4])[0]
        if typ == 1:
            zones.append(dict(name=name, root=d[i + 85], fine=_s8(d[i + 86]), vol=_s8(d[i + 88]),
                              lo=d[i + 90], hi=d[i + 91], vlo=d[i + 93], vhi=d[i + 94],
                              start=I(96), end=I(100), lstart=I(104), lend=I(108), loop=bool(d[i + 117] & 1),
                              coarse=_s8(d[i + 164]), group=I(172), sample=I(176)))
        elif typ == 2:
            groups.append(dict(name=name, vol=_s8(d[i + 84])))
        elif typ == 3:
            path_dir = d[i + 164:i + 164 + 256].split(b"\0")[0].decode("utf-8", "replace")
            samples.append(dict(name=name, dir=path_dir))
        i += size + 84
    for z in zones:
        g = groups[z["group"]] if 0 <= z["group"] < len(groups) else {"name": "", "vol": 0}
        z["gname"], z["gvol"] = g["name"], g["vol"]
    return zones, samples


SAMPLE_ROOTS = ["/Library/Application Support/GarageBand/Instrument Library/Sampler/Sampler Files",
                "/Library/Application Support/Logic/EXS Factory Samples"]
_index = None


def _find(name):
    """.exs 裡記的資料夾有時是 Apple 打包機器上的路徑（例如 /Users/hage/SVN/…）→ 到兩個取樣根目錄找同名檔"""
    global _index
    if _index is None:
        _index = {}
        for r in SAMPLE_ROOTS:
            for dp, _, fs in os.walk(r):
                for f in fs:
                    _index.setdefault(f, os.path.join(dp, f))
    return _index.get(name)


def _audio_file(sample):
    """取樣檔的實際路徑；.caf（AAC）先解成 WAV 快取"""
    p = Path(sample["dir"]) / sample["name"]
    if not p.exists():
        f = _find(sample["name"])
        if not f:
            raise FileNotFoundError(p)
        p = Path(f)
    if p.suffix.lower() != ".caf":
        return p
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / (p.stem + ".wav")
    if not out.exists() or out.stat().st_mtime < p.stat().st_mtime:
        tmp = out.with_suffix(".tmp.wav")
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(p), str(tmp)], check=True)
        tmp.rename(out)
    return out


class Inst:
    """一個樂器。kind：'oneshot'（鼓，整段播完、不管放開）、'pluck'（撥弦，放開後再響 release 秒）、
    'sustain'（拉弦／銅管，循環撐住長音，放開後 release 秒淡出）"""

    def __init__(self, exs, kind="pluck", include=None, exclude=None, gain_db=0.0, pan=0.0, reverb=0.25,
                 release=0.35, transpose=0, vel_curve=1.6, max_len=8.0, legato=None, release_group=None,
                 release_gain_db=0.0, layer=None, keymap=None):
        """legato：秒數。下一個音在這麼短的空隙內接上，就把前一個音延長到跟它重疊（拉弦樂器同一弓連下去，
                   不要每個音都收掉再重拉 —— 不然聽起來一個音一個音被切斷，2026-10-16 使用者回報）
        release_group：函式 (撐音的群組名, 音長) → 收弓群組名的正規表示式。一句結束時播「放開才響」的取樣
                   （二胡的 Rel／Rel Long），音尾才自然"""
        self.path = exs if exs.startswith("/") else (GB + exs if os.path.exists(GB + exs) else LOGIC + exs)
        self.kind, self.gain_db, self.pan, self.reverb = kind, gain_db, pan, reverb
        self.release, self.transpose, self.vel_curve, self.max_len = release, transpose, vel_curve, max_len
        self.legato, self.release_group, self.release_gain_db = legato, release_group, release_gain_db
        # layer：函式（群組名 → 聲部名）。同一個鍵有好幾個聲部的 zone 時**每個聲部各響一個**（疊層樂器）。
        #        查過 Full Brass：其實是依音域分工（低＝長號、中＝圓號、高＝小號），同一個鍵只有一個聲部 —— 設了也一樣，留著保險
        self.layer = layer
        # keymap：dict 或函式，MIDI 的鍵 → 這個樂器的鍵。舊的 MIDI 是照 GM 鼓組寫的（52 中國鈸、定音鼓有音高），
        #         換成 Chinese Kit／Taiko 時要對到它們的鍵位
        self.keymap = keymap
        zones, samples = parse_exs(self.path)
        self.all_zones = zones
        inc = re.compile(include) if include else None
        exc = re.compile(exclude) if exclude else None
        self.zones = [z for z in zones
                      if (not inc or inc.search(z["gname"]))      # ⚠️ include 只看群組名：古箏「滑音」群組裡的取樣也叫 Main Notes…
                      and not (exc and (exc.search(z["gname"]) or exc.search(z["name"])))]
        if not self.zones:
            raise ValueError(f"{exs}：include/exclude 之後一個 zone 都不剩")
        self.samples = samples
        self._files = {}
        self._rr = {}
        self._cache = {}

    def _read(self, sample_idx, a, b):
        key = (sample_idx, a, b)
        if key not in self._cache:
            if sample_idx not in self._files:
                self._files[sample_idx] = sf.SoundFile(str(_audio_file(self.samples[sample_idx])))
            f = self._files[sample_idx]
            f.seek(max(0, a))
            x = f.read(max(0, b - a), dtype="float32", always_2d=True)
            if x.shape[1] == 1:
                x = np.repeat(x, 2, axis=1)
            self._cache[key] = x[:, :2]
        return self._cache[key]

    def pick(self, key, vel):
        c = [z for z in self.zones if z["lo"] <= key <= z["hi"] and z["vlo"] <= vel <= z["vhi"]]
        if not c:   # 力度範圍沒涵蓋：放寬力度
            c = [z for z in self.zones if z["lo"] <= key <= z["hi"]]
        if not c:   # 鍵域外：找根音最近的
            c = sorted(self.zones, key=lambda z: abs(z["root"] - key))[:1]
        best = min(abs(z["root"] - key) for z in c)
        c = [z for z in c if abs(z["root"] - key) == best]
        c.sort(key=lambda z: (z["gname"], z["start"]))
        n = self._rr.get(key, 0)
        self._rr[key] = n + 1
        return c[n % len(c)]

    def voice(self, key, vel, dur, phrase_end=True):
        """一個音 → (stereo float32 陣列)。phrase_end：後面沒有連著的音（要收弓）"""
        if self.keymap:
            key = self.keymap(key) if callable(self.keymap) else self.keymap.get(key, key)
        if not self.layer:
            return self._voice(self.pick(key + self.transpose, vel), key, vel, dur, phrase_end)
        k = key + self.transpose
        groups = {}
        for z in self.zones:
            if z["lo"] <= k <= z["hi"] and z["vlo"] <= vel <= z["vhi"]:
                groups.setdefault(self.layer(z["gname"]), []).append(z)
        outs = []
        for name, c in groups.items():
            best = min(abs(z["root"] - k) for z in c)
            c = sorted([z for z in c if abs(z["root"] - k) == best], key=lambda z: (z["gname"], z["start"]))
            rk = (name, k)
            i = self._rr.get(rk, 0); self._rr[rk] = i + 1
            outs.append(self._voice(c[i % len(c)], key, vel, dur, phrase_end))
        if not outs:
            return self._voice(self.pick(k, vel), key, vel, dur, phrase_end)
        L = max(len(o) for o in outs)
        y = np.zeros((L, 2), np.float32)
        for o in outs:
            y[:len(o)] += o
        return y / np.sqrt(len(outs))          # 疊越多聲部越大聲，用平方根壓一點（跟分開的聲部相加差不多）

    def _voice(self, z, key, vel, dur, phrase_end=True):
        key += self.transpose
        rel = None
        if self.release_group and phrase_end:
            pat = re.compile(self.release_group(z["gname"], dur))
            c = [q for q in self.all_zones if pat.search(q["gname"]) and q["lo"] <= key <= q["hi"]
                 and q["vlo"] <= vel <= q["vhi"]]
            if c:
                rel = min(c, key=lambda q: abs(q["root"] - key))
        ratio = 2 ** ((key - z["root"] + z["coarse"] + z["fine"] / 100) / 12)
        amp = (vel / 127) ** self.vel_curve * 10 ** ((z["vol"] + z["gvol"] + self.gain_db) / 20)
        if self.kind == "oneshot":
            out_len = self.max_len
        elif self.kind == "pluck":
            out_len = min(self.max_len, dur + self.release)
        else:
            out_len = dur + self.release
        n_out = int(out_len * SR)
        need = int(n_out * ratio) + 4             # 原始取樣要讀幾格
        if self.kind == "sustain":
            att = self._read(z["sample"], z["start"], z["end"] if z["end"] > z["start"] else z["lend"])
            if z["loop"] and z["start"] <= z["lstart"] < z["lend"] <= z["end"] + 2:
                src = self._read(z["sample"], z["start"], z["lend"])
                body = self._read(z["sample"], z["lstart"], z["lend"])
            else:
                # ⚠️ 循環點失效（二胡這類 consolidated 的樂器檔：每個音只存 0.8 秒左右，循環點指到的是**別的音**的取樣，
                #    照用的話長音拉到 0.8 秒會接上別人、聽起來被截斷 —— 2026-10-16 使用者聽到「主旋律被截斷」）
                #    → 在自己取樣的尾段挑一段來循環（避開最後 40ms，那裡可能已經在收）
                n = len(att)
                skip = int(min(0.04 * SR, n * 0.05))
                L = int(min(0.4 * SR, n * 0.45))
                src = att[:n - skip]
                body = att[n - skip - L:n - skip]
            if len(src) < need and len(body) > 4096:
                # 交叉淡化循環（等功率）：body 開頭疊上自己的尾巴，每一圈接回去都是連續的
                xf = min(int(0.1 * SR), len(body) // 3)
                t = np.linspace(0, np.pi / 2, xf, dtype=np.float32)[:, None]
                loop = body[:-xf].copy()
                loop[:xf] = body[:xf] * np.sin(t) + body[-xf:] * np.cos(t)
                reps = int(np.ceil((need - len(src)) / len(loop))) + 1
                src = np.concatenate([src[:-xf]] + [loop] * reps)
        else:
            end = z["end"] if z["end"] > z["start"] else z["start"] + need
            src = self._read(z["sample"], z["start"], min(end, z["start"] + need))
        if len(src) < 2:
            return np.zeros((1, 2), np.float32)
        # 變調：線性內插重取樣
        pos = np.arange(0, min(need, len(src) - 1), ratio, dtype=np.float64)[:n_out]
        i0 = pos.astype(np.int64)
        frac = (pos - i0).astype(np.float32)[:, None]
        y = src[i0] * (1 - frac) + src[i0 + 1] * frac
        # 包絡：2ms 起音；放開後淡出
        a = min(len(y), int(0.002 * SR))
        if a:
            y[:a] *= np.linspace(0, 1, a, dtype=np.float32)[:, None]
        if self.kind != "oneshot":
            r0 = int(min(dur, out_len) * SR)
            if r0 < len(y):
                r = len(y) - r0
                # 有收弓取樣：撐音收得快一點（交給收弓取樣接手）；連音中間的音：慢慢淡，讓下一個音蓋過去
                depth = -9.0 if rel else (-6.0 if phrase_end else -3.5)
                y[r0:] *= np.exp(np.linspace(0, depth, r, dtype=np.float32))[:, None]
        else:
            t = min(len(y), int(0.03 * SR))
            y[-t:] *= np.linspace(1, 0, t, dtype=np.float32)[:, None]
        if rel is not None:
            rr = 2 ** ((key - rel["root"] + rel["coarse"] + rel["fine"] / 100) / 12)
            seg = self._read(rel["sample"], rel["start"], rel["end"])
            if len(seg) > 2:
                pos = np.arange(0, len(seg) - 1, rr)
                i0 = pos.astype(np.int64)
                fr = (pos - i0).astype(np.float32)[:, None]
                ry = (seg[i0] * (1 - fr) + seg[i0 + 1] * fr)
                ry *= (vel / 127) ** self.vel_curve * 10 ** ((rel["vol"] + rel["gvol"] + self.gain_db + self.release_gain_db) / 20) / amp if amp else 0
                t = min(len(ry), int(0.01 * SR))
                ry[-t:] *= np.linspace(1, 0, t, dtype=np.float32)[:, None]
                s0 = int(dur * SR)
                need_len = s0 + len(ry)
                if need_len > len(y):
                    y = np.concatenate([y, np.zeros((need_len - len(y), 2), np.float32)])
                y[s0:s0 + len(ry)] += ry
        return y * amp


class SynthBell:
    """編鐘（GarageBand 沒有）：不和諧泛音的鐘聲合成。編鐘的特色是敲下去「噹」一聲很亮、然後只剩低沉的嗡聲。
    跟 Inst 同一套介面（voice／gain_db／pan／reverb／legato）"""

    PARTIALS = [  # (頻率倍數, 相對音量, 衰減秒數)
        (0.5, 0.15, 5.0), (1.0, 1.0, 4.5), (1.19, 0.45, 2.2), (1.5, 0.3, 2.6), (2.0, 0.5, 2.0),
        (2.74, 0.35, 1.2), (3.76, 0.2, 0.7), (5.4, 0.12, 0.35), (8.93, 0.06, 0.15),
    ]

    def __init__(self, gain_db=0.0, pan=0.0, reverb=0.5, length=6.0, seed=3):
        self.gain_db, self.pan, self.reverb, self.length = gain_db, pan, reverb, length
        self.legato = None
        self.rng = np.random.default_rng(seed)

    def voice(self, key, vel, dur, phrase_end=True):
        f0 = 440 * 2 ** ((key - 69) / 12)
        n = int(self.length * SR)
        t = np.arange(n) / SR
        y = np.zeros(n, np.float32)
        for mult, amp, dec in self.PARTIALS:
            f = f0 * mult * (1 + self.rng.uniform(-0.002, 0.002))
            if f > SR / 2.2:
                continue
            ph = self.rng.uniform(0, 2 * np.pi)
            y += (amp * np.exp(-t / dec) * np.sin(2 * np.pi * f * t + ph)).astype(np.float32)
        # 敲擊瞬間的一點雜音（木槌打在銅上）
        k = int(0.012 * SR)
        y[:k] += (self.rng.standard_normal(k) * np.exp(-np.arange(k) / (0.003 * SR)) * 0.25).astype(np.float32)
        a = int(0.001 * SR)
        y[:a] *= np.linspace(0, 1, a, dtype=np.float32)
        y *= (vel / 127) ** 1.5 * 10 ** (self.gain_db / 20) * 0.3
        st = np.stack([y, np.roll(y, 37)], axis=1)       # 左右差一點點，聽起來比較寬
        return st


class SynthWind:
    """山風（GarageBand 沒有）：濾過的雜音，音量慢慢起伏。音高決定風聲的中心頻率，音符長度就是颳多久"""

    def __init__(self, gain_db=0.0, pan=0.0, reverb=0.2, fade=2.0, seed=11):
        self.gain_db, self.pan, self.reverb, self.fade = gain_db, pan, reverb, fade
        self.legato = None
        self.rng = np.random.default_rng(seed)

    def voice(self, key, vel, dur, phrase_end=True):
        n = int((dur + self.fade) * SR)
        N = 1 << (n - 1).bit_length()
        fc = 440 * 2 ** ((key - 69) / 12)
        f = np.fft.rfftfreq(N, 1 / SR)
        shape = np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) / 0.9) ** 2)   # 以 fc 為中心、約兩個八度寬
        out = []
        for _ in range(2):
            spec = np.fft.rfft(self.rng.standard_normal(N)) * shape
            out.append(np.fft.irfft(spec, N)[:n])
        y = np.stack(out, axis=1).astype(np.float32)
        y /= np.abs(y).max() + 1e-9
        t = np.arange(n) / SR
        gust = 0.65 + 0.35 * np.sin(2 * np.pi * t / 7.3 + 1.0) * np.sin(2 * np.pi * t / 3.1)   # 一陣一陣
        env = np.minimum(1, t / self.fade) * np.minimum(1, np.maximum(0, (dur + self.fade - t) / self.fade))
        y *= (gust * env)[:, None].astype(np.float32)
        return y * (vel / 127) * 10 ** (self.gain_db / 20) * 0.25


# ───────────────────────── MIDI ─────────────────────────
def read_midi(path):
    """回 {軌名: [(起秒, 長秒, 音高, 力度), …]}；只處理固定速度（我們自己寫的 MIDI 都是）"""
    d = open(path, "rb").read()
    assert d[:4] == b"MThd"
    _, ntrk, tpq = struct.unpack(">HHH", d[8:14])
    pos = 14
    tempo = 500000
    raw = []
    for _ in range(ntrk):
        assert d[pos:pos + 4] == b"MTrk"
        ln = struct.unpack(">I", d[pos + 4:pos + 8])[0]
        p, end = pos + 8, pos + 8 + ln
        t, status, name = 0, 0, None
        on, notes = {}, []
        while p < end:
            v = 0
            while True:
                b = d[p]; p += 1
                v = (v << 7) | (b & 0x7F)
                if b < 0x80:
                    break
            t += v
            b = d[p]
            if b == 0xFF:
                kind, p = d[p + 1], p + 2
                l = 0
                while True:
                    c = d[p]; p += 1
                    l = (l << 7) | (c & 0x7F)
                    if c < 0x80:
                        break
                data = d[p:p + l]; p += l
                if kind == 0x03:
                    name = data.decode("utf-8", "replace")
                elif kind == 0x51:
                    tempo = int.from_bytes(data, "big")
                continue
            if b & 0x80:
                status = b; p += 1
            hi = status & 0xF0
            if hi in (0x80, 0x90):
                k, vel = d[p], d[p + 1]; p += 2
                if hi == 0x90 and vel > 0:
                    on.setdefault(k, []).append((t, vel))
                elif on.get(k):
                    t0, v0 = on[k].pop(0)
                    notes.append((t0, t - t0, k, v0))
            elif hi in (0xA0, 0xB0, 0xE0):
                p += 2
            elif hi in (0xC0, 0xD0):
                p += 1
        raw.append((name, notes))
        pos = end
    sec = tempo / 1e6 / tpq
    return {n: [(a * sec, l * sec, k, v) for a, l, k, v in notes] for n, notes in raw if notes}


def legato_notes(notes, gap):
    """(起, 長, 音, 力度) → (起, 長, 音, 力度, 是不是一句的最後一個音)。
    gap：下一個音在這麼短的空隙內接上 → 前一個音延長到下一個音開始後 0.08 秒（兩個音交疊，聽起來是連著的）"""
    out = []
    notes = sorted(notes)
    for i, (a, l, k, v) in enumerate(notes):
        nxt = notes[i + 1] if i + 1 < len(notes) else None
        if gap and nxt and 0 <= nxt[0] - (a + l) <= gap:
            out.append((a, nxt[0] - a + 0.08, k, v, False))
        else:
            out.append((a, l, k, v, True))
    return out


# ───────────────────────── 殘響、混音 ─────────────────────────
def hall_ir(seconds=2.4, predelay=0.02, seed=7):
    """自己做的大廳殘響（立體聲、左右不相關的衰減雜訊，高頻衰得比較快）"""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)).astype(np.float32) * np.exp(-6.9 * t / seconds)[:, None].astype(np.float32)
    # 越後面越暗：跟一份低通過的版本交叉
    k = 24
    lp = np.cumsum(ir, axis=0)
    lp[k:] = lp[k:] - lp[:-k]
    lp /= k
    w = np.clip(t / (seconds * 0.5), 0, 1)[:, None].astype(np.float32)
    ir = ir * (1 - w) + lp * w * 2.5
    ir = np.concatenate([np.zeros((int(predelay * SR), 2), np.float32), ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0, keepdims=True))


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    out = np.empty((n, 2), np.float32)
    for ch in range(2):
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], N) * np.fft.rfft(ir[:, ch], N), N)[:n]
    return out


def render(midi_path, mapping, out_wav, total_seconds=None, loop_seconds=None, reverb_mix=1.0, verbose=True):
    """mapping：{軌名: Inst}。loop_seconds：給循環用 —— 前後各多算一輪，取中間那一輪（殘響尾巴會接回開頭）"""
    tracks = read_midi(midi_path)
    end = max(a + l for notes in tracks.values() for a, l, _, _ in notes)
    length = int(((total_seconds or end) + 4) * SR)
    dry = np.zeros((length, 2), np.float32)
    wet = np.zeros((length, 2), np.float32)
    for name, notes in tracks.items():
        inst = mapping.get(name)
        if inst is None:
            if verbose:
                print(f"  （略過沒對應樂器的軌：{name}）")
            continue
        buf = np.zeros((length, 2), np.float32)
        for a, l, k, v, end in legato_notes(notes, inst.legato):
            y = inst.voice(k, v, l, phrase_end=end)
            s = int(a * SR)
            e = min(length, s + len(y))
            if s < length:
                buf[s:e] += y[:e - s]
        th = (inst.pan + 1) * np.pi / 4               # 等功率聲像
        buf *= np.array([np.cos(th), np.sin(th)], np.float32) * np.sqrt(2)
        dry += buf
        wet += buf * inst.reverb
        if verbose:
            print(f"  {name}：{len(notes)} 個音，峰值 {20 * np.log10(np.abs(buf).max() + 1e-9):.1f} dB")
    mix = dry + convolve(wet, hall_ir())[:length] * 0.6 * reverb_mix
    if loop_seconds:
        L = int(loop_seconds * SR)
        # 第二輪的開頭帶著第一輪的殘響尾巴：取 [L, 2L) 這一段循環播放就不會斷
        mix = mix[L:2 * L]
    elif total_seconds:
        mix = mix[:int(total_seconds * SR)]
    peak = np.abs(mix).max()
    if peak > 0:
        mix = mix / peak * 0.89
    sf.write(str(out_wav), mix, SR, subtype="PCM_24")
    return out_wav


TARGET_LUFS = -16.0     # 所有 BGM 統一的響度（2026-10-16 使用者：「BGM 的音量要一致」）
TARGET_TP = -1.5


def to_mp3(wav, mp3, fade=None, quality=2):
    """兩階段 loudnorm（線性，不壓縮動態）→ MP3。所有 BGM 都走這裡，音量才會一致"""
    import json
    pre = "highpass=f=35:poles=2,"      # 35 Hz 以下手機喇叭放不出來，只會吃掉音量空間、讓鼓糊成一團
    af = pre + f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=11:print_format=json"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af", af, "-f", "null", "-"],
                       capture_output=True, text=True)
    m = json.loads(re.findall(r"\{[^{}]*\}", r.stderr)[-1])
    af2 = (f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=11:linear=true:"
           f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
           f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}")
    af2 = pre + af2
    if fade:
        af2 = f"afade=t=out:st={fade[0]}:d={fade[1]}," + af2
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-af", af2,
                    "-ar", str(SR), "-codec:a", "libmp3lame", "-q:a", str(quality), str(mp3)], check=True)
    return mp3


def stem_loudness(midi_path, mapping, seconds=None):
    """每一軌單獨演奏、量響度（LUFS）—— 調各軌 gain_db 用。峰值不等於聽起來的大小，鼓的峰值高但聽起來不一定大聲"""
    import tempfile
    tracks = read_midi(midi_path)
    res = {}
    for name, inst in mapping.items():
        notes = [n for n in tracks.get(name, []) if seconds is None or n[0] < seconds]
        if not notes:
            continue
        L = int(((seconds or max(a + l for a, l, _, _ in notes)) + 3) * SR)
        buf = np.zeros((L, 2), np.float32)
        for a, l, k, v, end in legato_notes(notes, inst.legato):
            y = inst.voice(k, v, l, phrase_end=end)
            s0 = int(a * SR)
            e = min(L, s0 + len(y))
            buf[s0:e] += y[:e - s0]
        with tempfile.NamedTemporaryFile(suffix=".wav") as t:
            sf.write(t.name, buf, SR)
            r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", t.name, "-af", "ebur128", "-f", "null", "-"],
                               capture_output=True, text=True).stderr
        res[name] = float(re.findall(r"I:\s+(-?[0-9.]+) LUFS", r)[-1])
    return res
