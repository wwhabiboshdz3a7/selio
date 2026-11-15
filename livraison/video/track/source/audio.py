"""Bande son de la vidéo Track : musique et bruitages synthétisés (commun/sons.py), calés sur timeline.json."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "commun"))
import sons  # noqa: E402

sons.setup(HERE)
music = sons.build_music(
    keys_on=[(0, 4.2), (6.0, 18.15), (20.0, 22.0)],
    drums_on=[(2.0, 4.2), (6.0, 18.15), (20.0, 22.0)],
    bass_on=[(2.0, 4.2), (6.0, 18.15), (20.0, 22.0)],
    hats_on=[(0.5, 2.0)],
    open_at=(1.0, 2.0),
    mutes=[(4.2, 5.98), (18.15, 19.98)],
    reveals=[4.75, 18.55],
    fills=[13.0, 17.5],
    final=22.0,
)
sons.mixdown(HERE, music, sons.build_sfx())
