"""Bande-son du spot Selio, 100 % synthétisée (numpy) : musique d'ambiance élégante + effets sonores
calés sur timing.json. Aucune ressource externe.

    python3 -I audio/make_audio.py [timing.json] [out_dir]

Produit : music.wav, sfx.wav, mix.wav (stéréo 48 kHz, pré-master, crête -1 dBFS).
"""
import json
import math
import os
import sys

import numpy as np

SR = 48000
timing_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "timing.json")
out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
T = json.load(open(timing_path))
S = T["scenes"]
DUR = float(T["duration"])
TAIL = 2.0
N = int((DUR + TAIL) * SR)
rng = np.random.default_rng(2024)

# ------------------------------------------------------------------ utilitaires
def sec(n):
    return np.arange(int(n * SR)) / SR

def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)

def add(buf, sig, t0, gain=1.0, pan=0.0):
    """Ajoute un signal mono (ou stéréo Nx2) dans buf (Nx2) à t0 s, pan ∈ [-1, 1]."""
    i0 = int(round(t0 * SR))
    if i0 >= len(buf):
        return
    sig = np.asarray(sig)
    if sig.ndim == 1:
        gl = gain * math.cos((pan + 1) * math.pi / 4)
        gr = gain * math.sin((pan + 1) * math.pi / 4)
        sig = np.stack([sig * gl, sig * gr], axis=1)
    else:
        sig = sig * gain
    n = min(len(sig), len(buf) - i0)
    buf[i0:i0 + n] += sig[:n]

def env(n, a, d, s, r, hold):
    """ADSR échantillonné : a/d/r en s, s niveau, hold = durée totale avant release (s)."""
    t = np.arange(n) / SR
    e = np.zeros(n)
    ia, ih = int(a * SR), int(hold * SR)
    e[:ia] = np.linspace(0, 1, max(ia, 1))[:ia]
    dec = np.exp(-(t[ia:ih] - t[ia] if ih > ia else 0) / max(d, 1e-3))
    if ih > ia:
        e[ia:ih] = s + (1 - s) * dec[: ih - ia]
    if n > ih:
        e[ih:] = e[ih - 1] * np.exp(-(t[ih:] - t[ih]) / max(r, 1e-3))
    return e

def fft_filter(x, lo=None, hi=None, slope=4.0):
    """Filtre passe-bande doux (domaine fréquentiel). lo/hi en Hz, slope = raideur (ordre Butterworth)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    H = np.ones_like(f)
    if hi:
        H *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope))
    if lo:
        H *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** (2 * slope))
    return np.fft.irfft(X * H, n)

def reverb(x, decay=2.4, damp=3500.0, wet=0.3, pre=0.02):
    """Réverbération par convolution avec une réponse impulsionnelle synthétique (bruit décroissant, stéréo)."""
    n_ir = int(decay * SR)
    t = np.arange(n_ir) / SR
    irs = []
    for ch in range(2):
        noise = rng.standard_normal(n_ir) * np.exp(-3.5 * t / decay)
        noise = fft_filter(noise, hi=damp, slope=2)
        noise[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
        irs.append(noise / np.sqrt(np.sum(noise ** 2)) * 0.9)
    out = np.zeros((len(x) + n_ir + int(pre * SR), 2))
    L = len(x) + n_ir
    nfft = 1 << (L - 1).bit_length()
    for ch in range(2):
        xin = x[:, ch] if x.ndim == 2 else x
        y = np.fft.irfft(np.fft.rfft(xin, nfft) * np.fft.rfft(irs[ch], nfft), nfft)[:L]
        out[int(pre * SR): int(pre * SR) + L, ch] = y
    dry = np.zeros_like(out)
    if x.ndim == 2:
        dry[: len(x)] = x
    else:
        dry[: len(x), 0] = x
        dry[: len(x), 1] = x
    return dry * (1 - wet) + out * wet

def saw(f, n, detune_cents=(0,)):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for c in detune_cents:
        ff = f * 2 ** (c / 1200)
        ph = (ff * t + rng.random()) % 1.0
        out += 2 * ph - 1
    return out / len(detune_cents)

# ------------------------------------------------------------------ structure harmonique (ré majeur)
# accords : (temps, [notes MIDI]) — changements calés sur les temps forts des scènes.
Bm = [59, 62, 66]
G = [55, 59, 62]
D = [50, 54, 57]
A = [57, 61, 64]
Dfin = [50, 54, 57, 64]  # ré majeur add9 pour la signature
hook, reveal, explore, sell, trust, pro, outro = (S[k][0] for k in ["hook", "reveal", "explore", "sell", "trust", "pro", "outro"])
# Durées de conception (version 60 s) : les évènements internes d'une scène (clics, bulles…) sont
# définis en "temps de conception" dans scene.js et comprimés si la scène est plus courte.
DESIGN = {"hook": 5.6, "reveal": 6.4, "explore": 11.8, "sell": 9.0, "trust": 7.4, "pro": 13.2, "outro": 9.0}
def K(name):
    a, b = S[name]
    return (b - a) / DESIGN[name]
kx, ks, kt, kp, ko, kr = K("explore"), K("sell"), K("trust"), K("pro"), K("outro"), K("reveal")
CHORDS = [
    (0.0, Bm), (2.6, G),
    (reveal, D), (reveal + 3.2 * kr, A),
    (explore, Bm), (explore + 2.8 * kx, G), (explore + 5.6 * kx, D), (explore + 8.4 * kx, A),
    (sell, G), (sell + 2.8 * ks, D), (sell + 5.6 * ks, A),
    (trust, Bm), (trust + 2.8 * kt, G), (trust + 5.2 * kt, A),
    (pro, D), (pro + 2.8 * kp, A), (pro + 5.6 * kp, Bm), (pro + 8.4 * kp, G), (pro + 10.8 * kp, A),
    (outro, Dfin),
]
BPM = 86.0
BEAT = 60.0 / BPM

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))

# ------------------------------------------------------------------ 1) nappe (pad)
pad = np.zeros((N, 2))
for i, (t0, notes) in enumerate(CHORDS):
    t1 = CHORDS[i + 1][0] if i + 1 < len(CHORDS) else DUR - 1.0
    hold = t1 - t0
    bright = 900 if t0 < explore else (1500 if t0 < pro else 2000)
    if t0 >= outro:
        bright = 1700
    n = int((hold + 2.5) * SR)
    e = env(n, 0.9 if i else 1.6, 0.4, 0.85, 1.6, hold)
    for k, m in enumerate(notes):
        for octv, g in ((0, 1.0), (-12, 0.55)):
            f = midi(m + octv)
            v = saw(f, n, (-7, 0, 7)) * g
            v = fft_filter(v, hi=bright, slope=2)
            pan = (-0.5 + k / max(len(notes) - 1, 1)) * 0.7
            add(pad, v * e, t0, 0.055, pan)
pad = reverb(pad, decay=3.0, damp=2600, wet=0.35)[:N]
# respiration lente (tremolo très doux) + montée de niveau par section
t_all = np.arange(N) / SR
breath = 1 - 0.08 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t_all))
level = np.interp(t_all, [0, 2.5, reveal, explore, pro, outro, DUR - 1.2, DUR], [0.35, 0.8, 1.0, 0.95, 1.1, 1.15, 1.0, 0.0])
music += pad * (breath * level)[:, None]

# ------------------------------------------------------------------ 2) piano électrique FM (accords plaqués, arpégés très légèrement)
ep = np.zeros((N, 2))
def fm_note(f, dur, idx0=2.2, tau=1.3, ratio=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    idx = idx0 * np.exp(-t / 0.5) + 0.15
    mod = np.sin(2 * np.pi * f * ratio * t) * idx
    sig = np.sin(2 * np.pi * f * t + mod)
    sig += 0.12 * np.sin(2 * np.pi * f * 2 * t)  # léger octave
    e = np.exp(-t / tau) * np.minimum(1, t / 0.004)
    return sig * e

for i, (t0, notes) in enumerate(CHORDS):
    if t0 < reveal:
        voicing = [notes[0] + 12, notes[2] + 12]  # intro : 2 notes seulement
    else:
        voicing = [m + 12 for m in notes] + [notes[0] + 24]
    for k, m in enumerate(voicing):
        add(ep, fm_note(midi(m), 3.2), t0 + k * 0.045, 0.16 if t0 >= pro else 0.13, (-0.4 + 0.8 * k / max(len(voicing) - 1, 1)) * 0.6)
    # petit contre-chant : la quinte à la moitié de l'accord
    if reveal <= t0 < outro:
        t1 = CHORDS[i + 1][0] if i + 1 < len(CHORDS) else DUR
        add(ep, fm_note(midi(notes[2] + 24), 2.0, idx0=1.4, tau=0.9), t0 + (t1 - t0) * 0.5, 0.07, 0.35)
ep = reverb(ep, decay=2.2, damp=4000, wet=0.28)[:N]
music += ep

# ------------------------------------------------------------------ 3) arpège "boîte à musique" (croches)
arp = np.zeros((N, 2))
def pluck(f, dur=0.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t / 0.08) + 0.1 * np.sin(2 * np.pi * f * 4.01 * t) * np.exp(-t / 0.05)
    return sig * np.exp(-t / 0.22) * np.minimum(1, t / 0.002)

t = reveal
step = BEAT / 2
k = 0
while t < DUR - 2.0:
    chord = [c for c in CHORDS if c[0] <= t][-1][1]
    seq = [chord[0] + 24, chord[1] + 24, chord[2] + 24, chord[1] + 36] if len(chord) < 4 else [chord[0] + 24, chord[2] + 24, chord[3] + 24, chord[1] + 36]
    m = seq[k % 4]
    section_gain = 0.028 if t < explore else (0.045 if t < pro else 0.06)
    if t >= outro:
        section_gain = 0.05 * max(0.0, 1 - (t - outro) / (DUR - outro - 1.5))
    vel = 1.0 if k % 4 == 0 else 0.72
    add(arp, pluck(midi(m)), t, section_gain * vel, 0.5 * math.sin(k * 1.3))
    t += step
    k += 1
arp = reverb(arp, decay=1.8, damp=6000, wet=0.4)[:N]
music += arp

# ------------------------------------------------------------------ 4) basse
bass = np.zeros((N, 2))
def bass_note(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.4)
    sig = np.tanh(1.6 * sig)
    e = np.minimum(1, t / 0.012) * np.exp(-t / (dur * 0.9))
    return sig * e

for i, (t0, notes) in enumerate(CHORDS):
    if t0 < explore or t0 >= outro:
        continue
    t1 = CHORDS[i + 1][0] if i + 1 < len(CHORDS) else outro
    f = midi(notes[0] - 24)
    tt = t0
    while tt < t1 - 0.05:
        add(bass, bass_note(f, min(BEAT * 1.9, t1 - tt)), tt, 0.19)
        tt += BEAT * 2
# accord final : basse tenue douce
add(bass, bass_note(midi(Dfin[0] - 24), 6.0), outro, 0.17)
music += bass

# ------------------------------------------------------------------ 5) percussions feutrées
drums = np.zeros((N, 2))
def kick(gain=1.0):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 42 + 90 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(ph) * np.exp(-t / 0.16)
    click = rng.standard_normal(n) * np.exp(-t / 0.004) * 0.25
    return (sig + fft_filter(click, lo=1500, hi=6000)) * gain

def hat(dur=0.05, gain=1.0):
    n = int(dur * 2.5 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = fft_filter(noise, lo=6500, hi=14000, slope=3)
    return noise * np.exp(-t / dur) * gain

def shaker(gain=1.0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    noise = fft_filter(rng.standard_normal(n), lo=3000, hi=9000, slope=2)
    e = np.minimum(1, t / 0.012) * np.exp(-t / 0.03)
    return noise * e * gain

def snap(gain=1.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = fft_filter(rng.standard_normal(n), lo=900, hi=4500, slope=2)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.03)
    return (noise * np.exp(-t / 0.045) + body * 0.5) * gain

first_beat = math.ceil(explore / BEAT)
last_beat = int(outro / BEAT)
for b in range(first_beat, last_beat + 1):
    tb = b * BEAT
    in_bar = b % 4
    section = "explore" if tb < pro else "pro"
    base = 0.55 if section == "explore" else 0.75
    if in_bar in (0, 2):
        add(drums, kick(0.9 if in_bar == 0 else 0.7), tb, base * 0.5)
    if section == "pro" and in_bar == 2:
        add(drums, snap(), tb, 0.22)
    # charleston : croches, accent sur les contretemps
    for h in range(2):
        th = tb + h * BEAT / 2
        if th >= outro:
            break
        g = 0.085 if h == 0 else 0.13
        if section == "pro":
            g *= 1.3
        add(drums, hat(0.045 if h == 0 else 0.07), th, g, 0.25)
    # shaker en double-croches à partir de "vendre"
    if tb >= sell:
        for q in range(4):
            tq = tb + q * BEAT / 4
            if tq >= outro:
                break
            add(drums, shaker(), tq, 0.045 if q % 2 else 0.065, -0.3)
# frappe finale douce sur la signature + cymbale montante
add(drums, kick(1.0), outro, 0.5)
n = int(2.5 * SR)
t = np.arange(n) / SR
cym = fft_filter(rng.standard_normal(n), lo=4000, hi=12000, slope=2) * np.exp(-t / 0.9)
add(drums, cym, outro, 0.08)
music += drums

# ------------------------------------------------------------------ 6) effets sonores (transitions + interface)
def whoosh(dur=0.9, f0=300, f1=3200, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # balayage spectral : on filtre par tranches avec une fréquence centrale montante
    out = np.zeros(n)
    k = 12
    edges = np.linspace(0, n, k + 1).astype(int)
    for i in range(k):
        fc = f0 * (f1 / f0) ** (i / (k - 1))
        seg = fft_filter(noise, lo=fc / 1.6, hi=fc * 1.6, slope=2)
        w = np.zeros(n)
        a, b = edges[i], edges[i + 1]
        w[a:b] = np.hanning(b - a) if b - a > 2 else 1
        out += seg * w
    e = (t / dur) ** 2.2 * np.exp(-((t - dur * 0.92) ** 2) / (2 * (dur * 0.12) ** 2)) + 0.15 * (t / dur)
    return out * e * gain

def impact(gain=1.0):
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    f = 38 + 70 * np.exp(-t / 0.08)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.35)
    air = fft_filter(rng.standard_normal(n), lo=200, hi=2500, slope=2) * np.exp(-t / 0.12) * 0.5
    return (body + air) * gain

def tick():
    n = int(0.04 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.006) + fft_filter(rng.standard_normal(n), lo=2500, hi=7000) * np.exp(-t / 0.004) * 0.6)

def pop(f0=380, f1=640, dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 + (f1 - f0) * (t / dur) ** 0.6
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur / 2.2)) * np.minimum(1, t / 0.003)

def chime(notes=(880, 1174.7, 1760), gain=1.0):
    out = np.zeros(int(1.2 * SR))
    for i, f in enumerate(notes):
        n = int(0.9 * SR)
        t = np.arange(n) / SR
        s = (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t / 0.35)
        add_i = int(i * 0.07 * SR)
        out[add_i: add_i + n] += s
    return out * gain

def shimmer(gain=1.0):
    """Scintillement pour l'apparition du logo : grappe de sinusoïdes aiguës qui s'épanouit."""
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for i, f in enumerate([1174.7, 1480, 1760, 2217, 2637, 2960]):
        d = i * 0.09
        tt = np.clip(t - d, 0, None)
        out += np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.5) * (tt > 0) * (0.8 ** i)
    return out * gain

# transitions
for cut, g in [(reveal, 0.5), (explore, 0.7), (sell, 0.55), (trust, 0.55), (pro, 0.75), (outro, 0.6)]:
    add(sfx, whoosh(0.9, gain=0.22 * g), cut - 0.85, 1.0, 0.0)
    add(sfx, impact(0.5 * g), cut, 1.0)
add(sfx, shimmer(0.09), reveal + 0.3 * kr)
add(sfx, shimmer(0.08), outro + 0.45 * ko)
# interface (offsets identiques à ceux de scene.js)
taps = [explore + 5.6 * kx, explore + 6.5 * kx, explore + 9.45 * kx, sell + 6.8 * ks, pro + 8.4 * kp]
for tt in taps:
    add(sfx, tick(), tt, 0.5)
for tt in [explore + 5.7 * kx, explore + 6.6 * kx]:
    add(sfx, pop(), tt, 0.35)
add(sfx, pop(520, 880, 0.12), explore + 9.5 * kx, 0.4)          # favori
for i in range(3):                                             # photos déposées
    add(sfx, pop(300, 420, 0.07), sell + (1.6 + i * 0.55 + 0.45) * ks, 0.25)
add(sfx, chime(gain=0.16), sell + 7.4 * ks)                        # annonce publiée
for tt in [trust + 2.05 * kt, trust + 3.35 * kt, trust + 4.75 * kt, trust + 5.95 * kt]:  # bulles de messages
    add(sfx, pop(700, 980, 0.07), tt, 0.22)
add(sfx, chime((987.8, 1318.5), 0.12), trust + 6.0 * kt)           # prix accepté
for i in range(5):                                             # interrupteurs d'automatisation
    add(sfx, tick(), pro + (4.5 + i * 0.3) * kp, 0.3)
add(sfx, chime((1046.5, 1568), 0.12), pro + 8.6 * kp)              # export prêt
sfx = reverb(sfx, decay=1.2, damp=5000, wet=0.18)[:N]

# ------------------------------------------------------------------ mix & pré-master
def soft_limit(x, ceiling=0.89):
    peak = np.max(np.abs(x))
    if peak > ceiling:
        x = x * (ceiling / peak)
    # compression douce des crêtes résiduelles
    return np.tanh(x * 1.15) / np.tanh(1.15)

def fade_out(x, start, end):
    i0, i1 = int(start * SR), int(end * SR)
    w = np.ones(len(x))
    w[i0:i1] = np.linspace(1, 0, i1 - i0) ** 1.5
    w[i1:] = 0
    return x * w[:, None]

music = fade_out(music, DUR - 1.3, DUR)
sfx = fade_out(sfx, DUR - 0.6, DUR)
mix = soft_limit(music * 1.0 + sfx * 1.0)
music_out = soft_limit(music)
sfx_out = soft_limit(sfx)

def write_wav(path, x):
    x = np.clip(x[: int(DUR * SR)], -1, 1)
    pcm = (x * 32767).astype("<i2")
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("→", path, f"{len(x) / SR:.1f}s peak={np.max(np.abs(x)):.2f}")

os.makedirs(out_dir, exist_ok=True)
write_wav(os.path.join(out_dir, "music.wav"), music_out)
write_wav(os.path.join(out_dir, "sfx.wav"), sfx_out)
write_wav(os.path.join(out_dir, "mix.wav"), mix)
