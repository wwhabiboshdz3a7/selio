"""Bande son des vidéos motion Selio, entièrement synthétisée (aucun échantillon tiers).

Instruments et bruitages repris de livraison/video-beta/source/audio.py ; arrangement générique à 120 BPM :
groove jusqu'au carton final (FIN), accord tenu ensuite. Usage : audio.py <timeline.json> <sortie.wav>
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
import sys
TL = json.loads(Path(sys.argv[1]).read_text())
SR = 48000
DUR = TL["DURATION"]
N = int(DUR * SR)
BEAT = 0.5
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(d * SR)) / SR


def hash1(n):
    s = np.sin(n * 127.1 + 311.7) * 43758.5453
    return s - np.floor(s)


def band(n, sr, lo, hi, order=4):
    f = np.fft.rfftfreq(n, 1 / sr)
    f[0] = 1e-3
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / f) ** order)
    if hi:
        m *= 1 / (1 + (f / hi) ** order)
    return m


def filt(x, lo=None, hi=None):
    n = len(x)
    return np.fft.irfft(np.fft.rfft(x) * band(n, SR, lo, hi), n)


def sweep(x, lo_fn, hi_fn, n=2048):
    """Filtre passe-bande variable dans le temps (STFT avec recouvrement)."""
    hop = n // 4
    win = np.hanning(n)
    out = np.zeros(len(x) + n)
    norm = np.zeros(len(x) + n)
    for s in range(0, len(x), hop):
        seg = x[s:s + n]
        if len(seg) < n:
            seg = np.pad(seg, (0, n - len(seg)))
        tc = (s + n / 2) / SR
        y = np.fft.irfft(np.fft.rfft(seg * win) * band(n, SR, lo_fn(tc), hi_fn(tc)), n)
        out[s:s + n] += y * win
        norm[s:s + n] += win ** 2
    return out[:len(x)] / np.maximum(norm[:len(x)], 1e-3)


def reverb(stereo, wet=0.2, length=1.8, decay=0.45):
    t = tt(length)
    out = stereo.copy()
    for ch in range(2):
        ir = rng.standard_normal(len(t)) * np.exp(-t / decay)
        ir = filt(ir, 120, 6000)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = 1 << int(np.ceil(np.log2(len(stereo) + len(ir))))
        y = np.fft.irfft(np.fft.rfft(stereo[:, ch], size) * np.fft.rfft(ir, size), size)[:len(stereo)]
        out[:, ch] = stereo[:, ch] + wet * y
    return out


def add(buf, sig, t0, gain=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[:len(buf) - i]
    a = (pan + 1) * np.pi / 4
    buf[i:i + len(sig), 0] += sig * gain * np.cos(a)
    buf[i:i + len(sig), 1] += sig * gain * np.sin(a)


# ---------------------------------------------------------------- instruments
def kick(vel=1.0):
    t = tt(0.5)
    f = 46 + 100 * np.exp(-t / 0.04)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    s[:150] += rng.standard_normal(150) * np.linspace(0.6, 0, 150)
    return np.tanh(1.6 * s) * vel


def clap(vel=1.0):
    t = tt(0.35)
    env = np.zeros_like(t)
    for d in (0.0, 0.011, 0.022):
        env += np.where(t >= d, np.exp(-(t - d) / (0.006 if d < 0.02 else 0.16)), 0)
    s = filt(rng.standard_normal(len(t)), 900, 6000) * env
    s += 0.35 * np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.06)
    return s * vel * 0.9


def hat(vel=1.0, open_=False):
    t = tt(0.25 if open_ else 0.08)
    return filt(rng.standard_normal(len(t)), 7000, None) * np.exp(-t / (0.12 if open_ else 0.022)) * vel


def ep_note(f, dur, vel):
    t = tt(dur)
    env = np.exp(-t / 0.85) * (1 - np.exp(-t / 0.004))
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t + 0.3) * np.exp(-t / 0.3)
         + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.15) + 0.06 * np.sin(2 * np.pi * 7.1 * f * t) * np.exp(-t / 0.02))
    return s * env * (1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)) * vel


def bass_note(f, dur, vel):
    t = tt(dur + 0.08)
    env = np.minimum(1, t / 0.006) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.03)) * (0.75 + 0.25 * np.exp(-t / 0.25))
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return np.tanh(1.3 * s) * env * vel


def saw_pad(freqs, dur, vel, attack=0.25):
    t = tt(dur)
    s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.12, 0.0, 0.13):
            ff = f * 2 ** (det / 12)
            for h in range(1, 13):
                s += np.sin(2 * np.pi * ff * h * t + h) / h
    env = np.minimum(1, t / attack) * np.exp(-np.maximum(0, t - attack) / (dur * 0.6))
    return filt(s, 80, 2200) * env * vel / (len(freqs) * 3)


def bell(f, dur, vel, tau=0.35):
    t = tt(dur)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (tau / r ** 0.5)) for r, a in ((1, 1), (2.76, 0.45), (5.4, 0.25), (8.93, 0.1)))
    return s * (1 - np.exp(-t / 0.002)) * vel


# ---------------------------------------------------------------- musique
CHORDS = [  # (accord, basse), une mesure de 2 s chacun : Lam7, Famaj7, Domaj7, Sol
    ([57, 60, 64, 67], 33),
    ([53, 57, 60, 64], 29),
    ([55, 59, 60, 64], 36),
    ([55, 59, 62, 67], 31),
]


def sub808(f, dur, vel, glide_from=None):
    """Basse 808 : sinus saturé, attaque nette, petite glissade éventuelle depuis la note précédente."""
    t = tt(dur + 0.15)
    ff = np.full_like(t, f)
    if glide_from:
        ff = f + (glide_from - f) * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(ff) / SR)
    env = np.minimum(1, t / 0.004) * np.where(t < dur, np.exp(-t / (dur * 1.8)), np.exp(-dur / (dur * 1.8)) * np.exp(-(t - dur) / 0.04))
    click = filt(rng.standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.003) * 0.25
    return np.tanh(2.2 * s * env) * vel + click * vel


def stab(chord, vel=1.0, dur=0.45):
    return saw_pad([hz(m) for m in chord] + [hz(chord[0] - 12)], dur, vel, attack=0.004)


def in_any(t, spans):
    return any(a <= t < b for a, b in spans)


def build_music():
    """Arrangement generique : groove 120 BPM du debut jusqu'au carton final (FIN), accord tenu ensuite."""
    drums = np.zeros((N, 2)); keys = np.zeros((N, 2)); bass = np.zeros((N, 2)); pads = np.zeros((N, 2))
    FIN = TL["FIN"]
    GROOVE = [(0.0, FIN - 0.05)]
    ROLLS = [(FIN - 0.5, FIN)]
    for b in range(int(DUR / 2) + 1):
        bar = b * 2.0
        chord, root = CHORDS[b % 4]
        if not in_any(bar, GROOVE):
            continue
        for k, off in enumerate((0.0, 0.75, 1.5)):
            t0 = bar + off
            if in_any(t0, GROOVE):
                for j, m in enumerate(chord if k != 2 else chord[1:]):
                    add(keys, ep_note(hz(m), 1.4, (0.5, 0.32, 0.38)[k]), t0 + j * 0.009, 0.5, (j - 1.5) * 0.25)
        prev = CHORDS[(b - 1) % 4][1]
        for off, d, oc in ((0.0, 0.65, 0), (0.75, 0.3, 0), (1.25, 0.55, 12 if b % 2 else 0), (1.75, 0.2, 7)):
            t0 = bar + off
            if in_any(t0, GROOVE) and b > 0:
                add(bass, sub808(hz(root + oc), d, 0.85, glide_from=hz(prev) if off == 0 else None), t0, 0.7)
        for i in range(16):
            t0 = bar + i * 0.125
            if not in_any(t0, GROOVE):
                continue
            beat = i / 4
            if (beat in (0.0, 1.75, 2.5) or (beat == 3.75 and b % 2)) and b > 0:
                add(drums, kick(1.0), t0, 0.95)
            if beat in (1.0, 3.0) and b > 0:
                add(drums, clap(), t0, 0.6, 0.05)
            roll = in_any(t0, ROLLS)
            if i % 2 == 0 or i % 4 == 3 or roll:
                add(drums, hat((0.5 if i % 4 == 0 else 0.32) * (1.25 if roll else 1), open_=(i % 8 == 6 and not roll)), t0, 0.36, 0.3)
            if roll:
                add(drums, hat(0.28), t0 + 0.0625, 0.3, 0.25)
    tail = max(0.6, DUR - FIN)
    add(pads, saw_pad([hz(m) for m in (45, 57, 60, 64, 67, 71)], min(2.2, tail), 1.0, attack=0.02), FIN)
    add(bass, sub808(hz(33), min(1.6, tail), 1.0), FIN, 0.8)
    add(drums, kick(1.0), FIN, 1.0)
    for k, off in enumerate((0.0, 0.35, 0.7, 1.05)):
        if FIN + 0.4 + off < DUR - 0.8:
            add(keys, ep_note(hz((69, 72, 76, 79)[k]), 1.2, 0.35), FIN + 0.4 + off, 0.5, (k - 1.5) * 0.3)
    music = drums + keys + bass + reverb(pads, wet=0.35)
    music = reverb(music, wet=0.12, length=1.2, decay=0.3)
    music[-int(0.9 * SR):] *= np.linspace(1, 0, int(0.9 * SR))[:, None]
    return music

def noise(d):
    return rng.standard_normal(int(d * SR))


def sfx_sound(kind, p):
    if kind == "tick":
        t = tt(0.03)
        return (np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.004) + 0.3 * filt(noise(0.03), 3000, None) * np.exp(-t / 0.002)) * 0.25, 0
    if kind == "pop":
        t = tt(0.12)
        f0 = 420 * 2 ** (p * 1.5 / 12)
        f = f0 * (1 + 1.4 * (1 - np.exp(-t / 0.02)))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * (1 - np.exp(-t / 0.001)) * 0.55, (hash1(p) - 0.5) * 0.8
    if kind == "blip":
        t = tt(0.07)
        return np.sin(2 * np.pi * (1250 + 300 * p) * t) * np.exp(-t / 0.018) * 0.35, 0.3
    if kind == "error":
        t = tt(0.1)
        sq = lambda f: sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 3, 5, 7))
        a = sq(392) * np.exp(-t / 0.08)
        return np.concatenate([a, sq(311) * np.exp(-t / 0.08)]) * 0.18, -0.3
    if kind == "notif":
        a, b = (1318.5, 1760.0) if p == 0 else (1568.0, 2093.0)
        return np.concatenate([bell(a, 0.09, 0.35, 0.15), bell(b, 0.6, 0.35, 0.3)]), (0.35 if p else -0.35)
    if kind == "key":
        t = tt(0.04)
        s = filt(noise(0.04), 1500, 7000) * np.exp(-t / 0.004) + 0.4 * np.sin(2 * np.pi * (2100 + 300 * hash1(p)) * t) * np.exp(-t / 0.006)
        return s * (0.16 + 0.08 * hash1(p + 3)), (hash1(p + 9) - 0.5) * 0.4
    if kind == "tap":
        t = tt(0.05)
        return (np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.008) + 0.5 * filt(noise(0.05), 2000, 8000) * np.exp(-t / 0.003)) * 0.3, 0
    if kind == "riser":
        d = p
        t = tt(d)
        u = t / d
        s = sweep(noise(d), lambda x: 200 + 2500 * (x / d) ** 2, lambda x: 700 + 7000 * (x / d) ** 2) * (u ** 2) * 0.5
        s += 0.12 * np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2.2 * u)) / SR) * u ** 1.5
        return s, 0
    if kind == "glitch":
        out = np.zeros(int(p * SR))
        for fr in range(int(p * 30)):
            if hash1(330 + fr) > 0.3:
                i = int(fr / 30 * SR)
                t = tt(0.03)
                f = 200 + 1800 * hash1(fr + 50)
                s = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + filt(noise(0.03), 500, 6000) * 0.5
                hold = 6 + int(10 * hash1(fr + 70))
                s = np.repeat(s[::hold], hold)[:len(t)]
                out[i:i + len(s)] += s[:len(out) - i] * 0.22
        return out, 0
    if kind == "suck":
        d = p
        t = tt(d)
        u = t / d
        s = sweep(noise(d), lambda x: 150 + 1800 * (x / d) ** 2, lambda x: 600 + 6000 * (x / d) ** 2) * (np.exp(4 * u) - 1) / (np.e ** 4 - 1)
        return s * 0.9, 0
    if kind == "impact":
        t = tt(1.6)
        f = 32 + 45 * np.exp(-t / 0.12)
        boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.9 if p == 0 else 0.45))
        hit = filt(noise(1.6), None, 2500) * np.exp(-t / 0.12)
        crash = filt(noise(1.6), 4000, None) * np.exp(-t / 0.5) * 0.25
        return np.tanh(1.4 * (boom + 0.5 * hit + crash)) * (0.9 if p == 0 else 0.55), 0
    if kind == "sparkle":
        d = p
        out = np.zeros(int((d + 0.6) * SR))
        notes = [79, 83, 86, 88, 91, 93, 95, 98]
        for k in range(10):
            i = int(k / 10 * d * SR)
            s = bell(hz(notes[int(hash1(k + 20) * 8)]), 0.5, 0.12, 0.18)
            out[i:i + len(s)] += s
        return out, 0
    if kind == "swish":
        d = 0.32
        t = tt(d)
        s = sweep(noise(d), lambda x: 500 + 1500 * (1 - x / d), lambda x: 1500 + 5000 * (1 - x / d)) * np.sin(np.pi * t / d) ** 2
        return s * 0.4, (-0.4 if p else 0.4)
    if kind == "whoosh":
        d = 0.55
        t = tt(d)
        up = p == 0
        s = sweep(noise(d), lambda x: 300 + 1500 * ((x / d) if up else 1 - x / d), lambda x: 1200 + 5000 * ((x / d) if up else 1 - x / d)) * np.sin(np.pi * t / d) ** 1.5
        return s * 0.5, 0
    if kind == "kaching":
        ch = filt(noise(0.08), 3000, 9000) * np.exp(-tt(0.08) / 0.02) * 0.4
        b = bell(2093, 0.8, 0.4, 0.35)
        b[int(0.06 * SR):] += bell(2637, 0.8 - 0.06, 0.4, 0.4)[:len(b) - int(0.06 * SR)]
        b[:len(ch)] += ch
        return b, 0.2
    if kind == "coin":
        return bell(2637, 0.5, 0.3, 0.25), -0.2
    if kind == "thud":
        t = tt(0.18)
        return (np.sin(2 * np.pi * np.cumsum(160 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.06)) * 0.5, 0
    if kind == "ding":
        return bell(1568 if p == 0 else 2093, 1.0, 0.45, 0.45), 0
    if kind == "check":
        return np.concatenate([bell(880, 0.07, 0.25, 0.08), bell(1318.5, 0.4, 0.3, 0.2)]), 0.15
    if kind == "shimmer":
        out = np.zeros(int(0.8 * SR))
        for k, m in enumerate((84, 88, 91, 96)):
            s = bell(hz(m), 0.6, 0.12, 0.2)
            i = int(k * 0.05 * SR)
            out[i:i + len(s)] += s[:len(out) - i]
        return out, 0
    if kind == "slam":
        d = 0.26
        t = tt(d)
        air = sweep(noise(d), lambda x: 300 + 1800 * (1 - x / d), lambda x: 1500 + 6000 * (1 - x / d)) * np.sin(np.pi * np.minimum(1, t / 0.16)) ** 2 * np.exp(-t / 0.12)
        f = (85 + 12 * hash1(p)) * (1 + 0.6 * np.exp(-t / 0.03))
        thud = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)
        return (0.35 * air + 0.6 * thud) * 0.8, (hash1(p + 4) - 0.5) * 0.7
    if kind == "beep":
        t = tt(0.05)
        return np.sin(2 * np.pi * (1400 + 120 * p) * t) * np.exp(-t / 0.015) * 0.3, 0.4
    if kind == "type":
        t = tt(0.03)
        s = filt(noise(0.03), 2500, 9000) * np.exp(-t / 0.003) + 0.3 * np.sin(2 * np.pi * (2600 + 400 * hash1(p)) * t) * np.exp(-t / 0.004)
        return s * 0.12, (hash1(p + 2) - 0.5) * 0.3
    if kind == "heart":
        t = tt(0.32)
        one = lambda t0: np.where(t >= t0, np.sin(2 * np.pi * 58 * (t - t0)) * np.exp(-np.maximum(0, t - t0) / 0.06), 0)
        return np.tanh(1.5 * (one(0.0) + 0.7 * one(0.13))) * 0.7, 0
    if kind == "shine":
        out = np.zeros(int(0.9 * SR))
        for k, m in enumerate((88, 91, 95, 98, 100, 103)):
            s = bell(hz(m), 0.6, 0.09, 0.16)
            i = int(k * 0.06 * SR)
            out[i:i + len(s)] += s[:len(out) - i]
        return out, 0
    if kind == "buzz":
        t = tt(0.32)
        s = np.sign(np.sin(2 * np.pi * 150 * t)) * 0.5 + np.sin(2 * np.pi * 150 * t)
        return filt(s, 60, 900) * np.minimum(1, t / 0.01) * np.minimum(1, (0.32 - t) / 0.03) * 0.35, 0
    if kind == "whip":
        d = 0.24
        t = tt(d)
        u = t / d
        s = sweep(noise(d), lambda x: 600 + 3000 * np.sin(np.pi * x / d), lambda x: 2500 + 7000 * np.sin(np.pi * x / d)) * np.sin(np.pi * u) ** 2
        return s * 0.45, (0.5 if p else -0.5)
    return None, 0


# Niveaux relatifs des bruitages (l'impact sert de référence, les petits sons sont remontés).
GAIN = {"tick": 3.0, "pop": 1.8, "blip": 2.0, "error": 3.0, "notif": 1.5, "key": 2.5, "tap": 3.5, "riser": 1.0, "glitch": 1.5,
        "suck": 1.6, "impact": 0.6, "sparkle": 1.5, "swish": 1.6, "whoosh": 1.4, "kaching": 1.2, "coin": 1.5, "thud": 2.0,
        "ding": 1.4, "check": 1.6, "shimmer": 1.8,
        "slam": 2.2, "beep": 3.5, "type": 3.2, "heart": 1.6, "shine": 1.4, "whip": 2.2, "buzz": 2.0}


def build_sfx():
    buf = np.zeros((N, 2))
    for t0, kind, p in TL["SFX"]:
        s, pan = sfx_sound(kind, p)
        if s is not None:
            add(buf, s, t0, GAIN.get(kind, 1.0), pan)
    return reverb(buf, wet=0.15, length=1.0, decay=0.25)


def write(path, x, peak=0.89):
    x = x / max(1e-9, np.max(np.abs(x))) * peak
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    music = build_music()
    m = music / np.max(np.abs(music))
    mix = 0.62 * m
    if TL["SFX"]:
        sfx = build_sfx()
        mix = mix + 0.8 * sfx / max(1e-9, np.max(np.abs(sfx)))
    write(Path(sys.argv[2]), mix)
