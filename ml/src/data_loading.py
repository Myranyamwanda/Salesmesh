"""Load the raw dataset.

Implemented in ml/notebooks/01_eda.ipynb and 02_preprocessing.ipynb, which read
the BAF Base dataset from the project's S3 bucket. Datasets are never committed;
local copies belong in data/, which Git ignores.

This module contains no code: the notebooks are the record of how model v1
was built, and the backend loads only the exported files.
"""
