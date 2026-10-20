"""Export the final model and its contract.

Implemented in ml/notebooks/05_export.ipynb. It writes model.joblib,
metadata.json, golden_examples.json, and coefficients.json; tracked copies of the
contract are in ml/model_contract/, and the model files are published as the
GitHub Release model-v1 (download with the dev.ps1 fetch-model command).

This module contains no code: the notebooks are the record of how model v1
was built, and the backend loads only the exported files.
"""
