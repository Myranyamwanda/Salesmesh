"""Select and prepare the model features.

Implemented in ml/notebooks/02_preprocessing.ipynb (the 13 features and the
time-based split). The preprocessing itself (median imputation with missing-value
indicators, scaling, one-hot encoding) is part of the exported scikit-learn
pipeline. In the running system, backend/app/ml/features.py builds the same 13
features from a customer registration.

This module contains no code: the notebooks are the record of how model v1
was built, and the backend loads only the exported files.
"""
