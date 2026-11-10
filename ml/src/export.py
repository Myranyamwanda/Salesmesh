"""Export the final model and its contract.

Implemented in ml/notebooks/05_export.ipynb. It writes model.joblib,
metadata.json, golden_examples.json, and coefficients.json; tracked copies of the
contract are in ml/model_contract/v1/, and the model files are published as
the GitHub Release model-v1. Model v2 (v1.4.0) is exported by ml/train_v2.py
into ml/model_contract/v2/ and the GitHub Release model-v2.

This module contains no code: the notebooks are the record of how model v1
was built, and the backend loads only the exported files.
"""
