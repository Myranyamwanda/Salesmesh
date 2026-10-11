# ML Workspace

Training code for the SalesMesh fraud-detection model. Nothing is implemented
yet because no dataset has been selected.

| Path | Contents |
| --- | --- |
| `src/data_loading.py` | Load the raw dataset from `data/` |
| `src/feature_engineering.py` | Build features and record their names |
| `src/training.py` | Train the model |
| `src/evaluation.py` | Compute metrics and choose the threshold |
| `src/export.py` | Save the model file and `metadata.json` to `artifacts/` |
| `notebooks/` | Exploratory analysis, once data exists |
| `artifacts/` | Generated model output (ignored by Git) |

See [ML scoring placeholder](../docs/ml-scoring.md) for the backend interface
and the output contract.
