"""
生成小食伴温馨用餐背景音乐（可无缝循环）
输出：assets/music/music.wav 与 assets/music/music.mp3
"""

import math
import struct
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
BPM = 76
BEAT = 60.0 / BPM
BARS = 16
BEATS_PER_BAR = 4
DURATION = BARS * BEATS_PER_BAR * BEAT
OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "music"

# C 大调五声音阶（温馨、幼儿友好）
NOTE = {
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "G4": 392.0,
    "A4": 440.0,
    "C5": 523.25,
    "E5": 659.25,
    "G5": 783.99,
}

CHORDS = [
    ("C4", "E4", "G4"),
    ("F4", "A4", "C5") if "F4" in NOTE else ("F4", "A4", "C5"),
    ("C4", "E4", "G4"),
    ("G4", "B4", "D5") if "B4" in NOTE else ("G4", "D5", "G5"),
]

NOTE.update({"F4": 349.23, "A4": 440.0, "B4": 493.88, "D5": 587.33, "G5": 783.99})

CHORDS = [
    ("C4", "E4", "G4"),
    ("F4", "A4", "C5"),
    ("C4", "E4", "G4"),
    ("G4", "B4", "D5"),
]

MELODY = [
    ("E4", 1), ("G4", 1), ("A4", 2),
    ("G4", 1), ("E4", 1), ("C4", 2),
    ("D4", 1), ("E4", 1), ("G4", 2),
    ("E4", 1), ("D4", 1), ("C4", 2),
    ("E4", 1), ("G4", 1), ("C5", 2),
    ("A4", 1), ("G4", 1), ("E4", 2),
    ("G4", 1), ("A4", 1), ("G4", 2),
    ("E4", 1), ("D4", 1), ("C4", 2),
] * 2


def t_array():
    return np.linspace(0, DURATION, int(SAMPLE_RATE * DURATION), endpoint=False)


def adsr(length, attack=0.02, decay=0.08, sustain=0.6, release=0.15):
    n = length
    env = np.zeros(n)
    a = int(attack * SAMPLE_RATE)
    d = int(decay * SAMPLE_RATE)
    r = int(release * SAMPLE_RATE)
    s = max(0, n - a - d - r)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if d > 0:
        env[a : a + d] = np.linspace(1, sustain, d)
    if s > 0:
        env[a + d : a + d + s] = sustain
    if r > 0:
        env[a + d + s :] = np.linspace(sustain, 0, r)
    return env


def tone(freq, start, dur, amp=0.2, timbre="soft"):
    n = int(dur * SAMPLE_RATE)
    if n <= 0:
        return np.zeros(int(DURATION * SAMPLE_RATE))
    t = np.arange(n) / SAMPLE_RATE
    if timbre == "soft":
        wave_sig = np.sin(2 * np.pi * freq * t)
        wave_sig += 0.25 * np.sin(2 * np.pi * freq * 2 * t)
        wave_sig += 0.08 * np.sin(2 * np.pi * freq * 3 * t)
    elif timbre == "pluck":
        wave_sig = np.sin(2 * np.pi * freq * t)
        wave_sig *= np.exp(-3.5 * t)
    else:
        wave_sig = np.sin(2 * np.pi * freq * t)

    wave_sig *= adsr(n, attack=0.01, decay=0.12, sustain=0.45, release=min(0.2, dur * 0.35))
    wave_sig *= amp

    out = np.zeros(int(DURATION * SAMPLE_RATE))
    i0 = int(start * SAMPLE_RATE)
    i1 = min(i0 + n, len(out))
    out[i0:i1] = wave_sig[: i1 - i0]
    return out


def pad_layer():
    mix = np.zeros(int(DURATION * SAMPLE_RATE))
    bar_len = BEATS_PER_BAR * BEAT
    for bar in range(BARS):
        chord = CHORDS[bar % len(CHORDS)]
        start = bar * bar_len
        for name in chord:
            mix += tone(NOTE[name], start, bar_len * 0.98, amp=0.045, timbre="soft")
    return mix


def melody_layer():
    mix = np.zeros(int(DURATION * SAMPLE_RATE))
    cursor = 0.0
    for name, beats in MELODY:
        dur = beats * BEAT * 0.92
        if cursor + beats * BEAT > DURATION:
            break
        mix += tone(NOTE[name], cursor, dur, amp=0.11, timbre="pluck")
        cursor += beats * BEAT
    return mix


def sparkle_layer():
    mix = np.zeros(int(DURATION * SAMPLE_RATE))
    bar_len = BEATS_PER_BAR * BEAT
    sparkle_notes = ["C5", "E5", "G5", "A4"]
    for bar in range(0, BARS, 4):
        start = bar * bar_len + BEAT * 2.5
        if start >= DURATION:
            break
        name = sparkle_notes[(bar // 4) % len(sparkle_notes)]
        mix += tone(NOTE[name], start, BEAT * 0.7, amp=0.035, timbre="pluck")
    return mix


def soft_pulse():
    mix = np.zeros(int(DURATION * SAMPLE_RATE))
    for beat_i in range(int(DURATION / BEAT)):
        if beat_i % BEATS_PER_BAR not in (0, 2):
            continue
        start = beat_i * BEAT
        n = int(0.06 * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        click = np.sin(2 * np.pi * 180 * t) * np.exp(-40 * t) * 0.018
        i0 = int(start * SAMPLE_RATE)
        i1 = min(i0 + n, len(mix))
        mix[i0:i1] += click[: i1 - i0]
    return mix


def master(mix):
    mix = mix - np.mean(mix)
    peak = np.max(np.abs(mix)) or 1.0
    mix = mix / peak * 0.82
    # 淡入淡出，便于循环
    fade = int(0.8 * SAMPLE_RATE)
    ramp = np.linspace(0, 1, fade)
    mix[:fade] *= ramp
    mix[-fade:] *= ramp[::-1]
    return mix


def write_wav(path, data):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype(np.int16)
    stereo = np.column_stack([pcm, pcm])
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(stereo.tobytes())


def write_mp3(path, data):
    try:
        import lameenc
    except ImportError:
        return False

    data = np.clip(data, -1, 1)
    mono = (data * 32767).astype(np.int16)
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    mp3_data = encoder.encode(mono.tobytes())
    mp3_data += encoder.flush()
    path.write_bytes(mp3_data)
    return True


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mix = master(pad_layer() + melody_layer() + sparkle_layer() + soft_pulse())
    wav_path = OUT_DIR / "music.wav"
    mp3_path = OUT_DIR / "music.mp3"
    write_wav(wav_path, mix)
    print(f"Wrote {wav_path} ({wav_path.stat().st_size // 1024} KB)")

    try:
        import subprocess
        import sys

        subprocess.check_call([sys.executable, "-m", "pip", "install", "lameenc", "-q"])
        if write_mp3(mp3_path, mix):
            print(f"Wrote {mp3_path} ({mp3_path.stat().st_size // 1024} KB)")
            return
    except Exception as err:
        print("MP3 encode fallback:", err)

    # 无 MP3 编码器时保留 WAV，复制一份供 bgm 使用
    if not mp3_path.exists():
        import shutil

        shutil.copy(wav_path, OUT_DIR / "music_loop.wav")
        print("MP3 unavailable; using WAV for playback")


if __name__ == "__main__":
    main()
