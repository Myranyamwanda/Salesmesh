"""Load the raw dataset from data/ into memory.

Placeholder: no dataset has been selected. Raw files belong in data/, which Git
ignores, so datasets are never committed.
"""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def load_raw_data(path: Path = DATA_DIR):
    """Read the raw dataset and return it unchanged.

    TODO: Choose the file format and loading library once the dataset is known.
    """
    raise NotImplementedError("No dataset has been selected yet")
