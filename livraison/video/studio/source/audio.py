"""Bande son de la vidéo Studio : musique et bruitages synthétisés (commun/sons.py), calés sur timeline.json."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "commun"))
import sons  # noqa: E402

sons.setup(HERE)
music = sons.build_music(
    keys_on=[(0, 6.45), (8.0, 22.55), (24.0, 26.0)],
    drums_on=[(2.0, 6.45), (8.0, 22.55), (24.0, 26.0)],
    bass_on=[(3.0, 6.45), (8.0, 22.55), (24.0, 26.0)],
    hats_on=[(0.5, 2.0)],
    open_at=(1.9, 2.9),
    mutes=[(6.45, 7.98), (22.55, 23.98)],
    reveals=[6.95, 22.85],
    fills=[5.5, 21.5],
    final=26.0,
)
sons.mixdown(HERE, music, sons.build_sfx())
