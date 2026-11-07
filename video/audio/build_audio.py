"""Synthesize the score and sound effects for the Korea documentary, all from code.

Usage: python3 build_audio.py events.json duration_seconds out_dir
Writes out_dir/music.wav and out_dir/sfx.wav (48 kHz stereo). The narration is mixed in by ffmpeg,
which also ducks the music under the voice.
"""
import json, sys, wave
import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(7)
events = json.load(open(sys.argv[1]))
DUR = float(sys.argv[2])
OUT = sys.argv[3]
INK = len(sys.argv) > 4 and sys.argv[4] == "ink"
N = int(np.ceil(DUR * SR)) + SR  # one second of tail room, trimmed later


def t_axis(n):
    return np.arange(n) / SR


def env_exp(n, decay):
    return np.exp(-t_axis(n) / decay)


def bandnoise(n, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="bandpass", fs=SR, output="sos")
    return signal.sosfilt(sos, rng.standard_normal(n))


def lowpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="lowpass", fs=SR, output="sos"), x)


def highpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="highpass", fs=SR, output="sos"), x)


def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= len(buf):
        return
    x = x[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * gain * l * 1.414
    buf[i:i + len(x), 1] += x * gain * r * 1.414


def reverb_ir(seconds=2.6, decay=0.7, seed=3):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = r.standard_normal((n, 2)) * np.exp(-t_axis(n) / decay)[:, None]
    ir[:, 0] = lowpass(ir[:, 0], 6000)
    ir[:, 1] = lowpass(ir[:, 1], 6000)
    return ir / np.sqrt((ir ** 2).sum(axis=0))


def convolve_st(x, ir):
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)


# ---------------------------------------------------------------- music
def note_hz(name):
    names = {"C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
    p, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[p] + 12 * (o + 1) - 69) / 12)


CHORDS = {  # voiced low and warm
    "Dm": ["D3", "A3", "D4", "F4", "A4"], "Bb": ["Bb2", "F3", "D4", "F4", "Bb4"], "F": ["F2", "C3", "A3", "C4", "F4"],
    "C": ["C3", "G3", "C4", "E4", "G4"], "Gm": ["G2", "D3", "Bb3", "D4", "G4"], "A": ["A2", "E3", "C#4", "E4", "A4"],
    "Fsus": ["F2", "C3", "Bb3", "C4", "F4"],
}
# (start time, chord, level): calm opening, darker through invasion and annexation, lift at independence,
# dark again for the war, then rising and resolving to F major for the present day.
PROG = [(0, "Dm", 0.55), (7.3, "Bb", 0.7), (12.0, "F", 0.75), (19.9, "C", 0.75), (25.9, "Dm", 0.7), (31.7, "Bb", 0.7),
        (38.2, "F", 0.75), (44.3, "C", 0.8), (49.9, "Gm", 0.85), (55.0, "A", 0.9), (59.4, "Dm", 0.85), (63.1, "F", 0.85),
        (67.9, "Bb", 0.8), (74.4, "Gm", 0.85), (77.5, "A", 0.8), (81.5, "Bb", 0.8), (85.0, "C", 0.85), (88.1, "Dm", 0.8),
        (91.5, "Bb", 0.85), (94.4, "Fsus", 0.9), (96.8, "F", 1.0)]


def pad_note(f, n):
    t = t_axis(n)
    x = np.zeros(n)
    for det in (-0.07, 0.0, 0.06):  # three slightly detuned voices
        ff = f * 2 ** (det / 12)
        ph = rng.uniform(0, 2 * np.pi)
        for h in range(1, 9):
            if ff * h > 5000:
                break
            x += np.sin(2 * np.pi * ff * h * t + ph * h) / h ** 1.6
    trem = 1 + 0.08 * np.sin(2 * np.pi * rng.uniform(0.07, 0.15) * t + rng.uniform(0, 6))
    return x * trem


def build_music():
    mus = np.zeros((N, 2))
    for i, (t0, ch, lvl) in enumerate(PROG):
        t1 = PROG[i + 1][0] if i + 1 < len(PROG) else DUR + 0.6
        att, rel = 2.2, 2.8
        n = int((t1 - t0 + rel) * SR)
        env = np.ones(n)
        a = int(att * SR); env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
        r0 = int((t1 - t0) * SR); env[r0:] = np.cos(np.linspace(0, np.pi / 2, n - r0)) ** 2
        for k, nm in enumerate(CHORDS[ch]):
            x = pad_note(note_hz(nm), n) * env * lvl * (1.0 if k == 0 else 0.55)
            place(mus, x, t0, 0.05, pan=(k - 2) * 0.25)
        # sub drone on the root
        root = note_hz(CHORDS[ch][0]) / 2
        place(mus, np.sin(2 * np.pi * root * t_axis(n)) * env * lvl, t0, 0.09)
    for c in range(2):
        mus[:, c] = lowpass(mus[:, c], 2400)
    # low pulse under the two dark passages (invasion and war)
    for a, b, step in ((50.0, 62.4, 1.5), (74.4, 81.0, 1.5)):
        for t in np.arange(a, b, step):
            n = int(0.7 * SR); tt = t_axis(n)
            hit = np.sin(2 * np.pi * (55 + 25 * np.exp(-tt / 0.05)) * tt) * np.exp(-tt / 0.18)
            ramp = min(1.0, (t - a) / 3.0) * min(1.0, (b - t) / 1.5)
            place(mus, hit, t, 0.16 * ramp)
    wet = convolve_st(mus, reverb_ir(3.2, 0.9))
    mus = 0.65 * mus + 0.6 * wet
    # opening swell and gentle fade at the very end
    fade_in = np.clip(t_axis(N) / 3.0, 0, 1) ** 2
    fade_out = np.clip((DUR + 0.4 - t_axis(N)) / 2.5, 0, 1)
    mus *= (fade_in * fade_out)[:, None]
    return mus


# ---------------------------------------------------------------- sound effects
def whoosh(dur, soft=False):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    # cutoff rises then falls with the camera's speed (sine-eased moves peak in the middle)
    shape = np.sin(np.pi * np.clip(t_axis(n) / dur, 0, 1)) ** 2
    out = np.zeros(n)
    blocks = 64
    edges = np.linspace(0, n, blocks + 1).astype(int)
    zi = None
    for i in range(blocks):
        s0, s1 = edges[i], edges[i + 1]
        fc = 250 + 1500 * shape[(s0 + s1) // 2]
        sos = signal.butter(2, fc, btype="lowpass", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        y, zi = signal.sosfilt(sos, x[s0:s1], zi=zi)
        out[s0:s1] = y
    return out * shape * (0.35 if soft else 1.0)


def pin():
    n = int(0.25 * SR); t = t_axis(n)
    return (np.sin(2 * np.pi * 1320 * t) * 0.6 + np.sin(2 * np.pi * 1980 * t) * 0.25) * np.exp(-t / 0.05)


def paper(soft=False):
    n = int(0.5 * SR); t = t_axis(n)
    flutter = bandnoise(n, 1800, 7000) * np.exp(-t / 0.05) * (1 + 0.6 * np.sin(2 * np.pi * 35 * t))
    thump = np.sin(2 * np.pi * (95 + 40 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.07)
    x = 0.6 * flutter / (np.abs(flutter).max() + 1e-9) + 0.9 * thump
    return x * (0.45 if soft else 1.0)


def key():
    n = int(0.12 * SR); t = t_axis(n)
    click = highpass(rng.standard_normal(n), 2500) * np.exp(-t / 0.004)
    body = np.sin(2 * np.pi * rng.uniform(170, 230) * t) * np.exp(-t / 0.018)
    x = click / (np.abs(click).max() + 1e-9) + 0.5 * body
    return x * rng.uniform(0.8, 1.0)


def pen(dur, soft=False):
    n = int((dur + 0.08) * SR); t = t_axis(n)
    x = bandnoise(n, 1500, 5000)
    am = 0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 9 * t + 2 * np.sin(2 * np.pi * 3 * t)))
    env = np.clip(t / 0.03, 0, 1) * np.clip((dur + 0.08 - t) / 0.08, 0, 1)
    x = x * am * env
    return x / (np.abs(x).max() + 1e-9) * (0.4 if soft else 1.0)


def thud(n_s=0.9, f0=48, f1=130, slap=0.0):
    n = int(n_s * SR); t = t_axis(n)
    boom = np.sin(2 * np.pi * (f0 * t + (f1 - f0) * 0.03 * (1 - np.exp(-t / 0.03)))) * np.exp(-t / 0.22)
    knock = lowpass(rng.standard_normal(n), 900) * np.exp(-t / 0.03)
    x = boom + 0.5 * knock / (np.abs(knock).max() + 1e-9)
    if slap:
        s = bandnoise(n, 900, 4500) * np.exp(-t / 0.025)
        x += slap * s / (np.abs(s).max() + 1e-9)
    return x / np.abs(x).max()


# ---------------------------------------------------------------- ink-wash score: guqin-like plucks over a low drone
PENTA = [0, 3, 5, 7, 10]  # minor pentatonic intervals


def guqin(f, dur=3.5, slide=0.0, harmonic=False):
    n = int(dur * SR); t = t_axis(n)
    fr = f * (1 + slide * np.clip(t / 0.25, 0, 1))            # a small slide after the pluck
    ph = 2 * np.pi * np.cumsum(fr) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.4, 0, 1)
    x = np.zeros(n)
    hs = (1, 2, 3, 4, 5, 6, 7, 8) if not harmonic else (2, 4, 6)
    for h in hs:
        x += np.sin(ph * h * vib * (1 + 0.0008 * h * h)) * np.exp(-t / (2.4 / h ** 0.7)) / h ** (1.1 if not harmonic else 0.6)
    pick = highpass(rng.standard_normal(n), 1500) * np.exp(-t / 0.006) * 0.25
    return (x + pick) * np.clip(t / 0.003, 0, 1)


def build_music_ink():
    mus = np.zeros((N, 2))
    r = np.random.default_rng(11)
    for i, (t0, ch, lvl) in enumerate(PROG):
        t1 = PROG[i + 1][0] if i + 1 < len(PROG) else DUR + 0.6
        root = note_hz(CHORDS[ch][0])
        # drone: low root and fifth, breathing
        n = int((t1 - t0 + 2.5) * SR); tt = t_axis(n)
        env = np.clip(tt / 1.8, 0, 1) * np.clip((t1 - t0 + 2.5 - tt) / 2.5, 0, 1)
        dr = (np.sin(2 * np.pi * root / 2 * tt) + 0.35 * np.sin(2 * np.pi * root * 0.75 * tt)) * env * (1 + 0.15 * np.sin(2 * np.pi * 0.11 * tt))
        place(mus, dr, t0, 0.06 * lvl)
        # unmetred plucks from the pentatonic on this root
        t = t0 + r.uniform(0.2, 0.8)
        while t < t1 - 0.3:
            step = PENTA[r.integers(0, 5)] + 12 * r.integers(1, 3)
            f = root * 2 ** (step / 12)
            harm = r.random() < 0.18
            place(mus, guqin(f, 3.2, slide=r.choice([0, 0, 0.03, -0.02]), harmonic=harm), t, 0.11 * lvl, pan=r.uniform(-0.3, 0.3))
            t += r.uniform(0.9, 2.4) * (0.8 if lvl > 0.8 else 1.0)
    # breath of silence before the decisive stroke on the 38th parallel
    s0, s1 = int(70.9 * SR), int(72.3 * SR)
    fade = np.ones(N); fade[s0 - 4800:s0] = np.linspace(1, 0, 4800); fade[s0:s1] = 0; fade[s1:s1 + 2400] = np.linspace(0, 1, 2400)
    wet = convolve_st(mus, reverb_ir(3.6, 1.1))
    mus = (0.6 * mus + 0.7 * wet) * fade[:, None]
    fade_in = np.clip(t_axis(N) / 2.0, 0, 1) ** 2
    fade_out = np.clip((DUR + 0.4 - t_axis(N)) / 2.5, 0, 1)
    return mus * (fade_in * fade_out)[:, None] * 2.2


def gong(n_s=2.5):
    n = int(n_s * SR); t = t_axis(n); x = np.zeros(n)
    for f, d, a in ((210, 1.6, 1), (337, 1.1, 0.6), (523, 0.7, 0.4), (781, 0.4, 0.25)):
        x += a * np.sin(2 * np.pi * f * t * (1 - 0.01 * np.exp(-t / 0.3))) * np.exp(-t / d)
    return x / np.abs(x).max()


def build_sfx():
    sfx = np.zeros((N, 2))
    for e in events:
        ty, t = e["type"], e["t"]
        if ty == "whoosh": place(sfx, whoosh(e["dur"], e.get("soft")), t, 0.05)
        elif ty == "pin": place(sfx, pin(), t, 0.035)
        elif ty == "paper": place(sfx, paper(), t, 0.11)
        elif ty == "paper_soft": place(sfx, paper(True), t, 0.08)
        elif ty == "key": place(sfx, key(), t, 0.085, pan=rng.uniform(-0.15, 0.15))
        elif ty == "pen": place(sfx, pen(e["dur"], e.get("soft")), t, 0.06)
        elif ty == "slam": place(sfx, thud(0.9, 46, 140), t, 0.5)
        elif ty == "stamp":
            place(sfx, thud(0.8, 52, 160, slap=0.7), t, 0.55)
            if INK: place(sfx, gong(), t + 0.02, 0.18)
    wet = convolve_st(sfx, reverb_ir(1.4, 0.35, seed=5))
    return sfx + 0.18 * wet


def write(path, x):
    x = x[: int(round(DUR * SR))]
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


m = build_music_ink() if INK else build_music(); s = build_sfx()
print("music peak", float(np.abs(m).max()), "rms", float(np.sqrt((m ** 2).mean())))
print("sfx peak", float(np.abs(s).max()))
write(f"{OUT}/music.wav", m); write(f"{OUT}/sfx.wav", s)
print("wrote", OUT)
