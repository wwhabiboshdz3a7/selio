"""Bande son de la vidéo Bot : musique et bruitages synthétisés (commun/sons.py), calés sur timeline.json.
La nuit (0 → 6,4 s) : piano seul, doux et filtré, nappe grave ; le groove démarre avec la révélation."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "commun"))
import sons  # noqa: E402

sons.setup(HERE)
music = sons.build_music(
    keys_on=[(0, 6.45), (8.0, 23.95), (26.0, 28.0)],
    drums_on=[(8.0, 23.95), (26.0, 28.0)],
    bass_on=[(3.0, 6.45), (8.0, 23.95), (26.0, 28.0)],
    hats_on=[(3.0, 6.45)],
    mutes=[(6.45, 7.98), (23.95, 25.98)],
    reveals=[6.95, 24.35],
    fills=[19.0, 23.5],
    final=28.0,
    soft=[(0, 3.0)],
)
music = music + sons.drone(0.0, 3.0, 0.1)
sons.mixdown(HERE, music, sons.build_sfx())
