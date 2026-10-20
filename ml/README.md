# ML Workspace

The SalesMesh fraud model was developed in the Jupyter notebooks in
`notebooks/`. They are the complete research record and are not changed after
the fact (Ruff and the other hooks skip them). The backend uses only the
exported result.

| Notebook | Stage |
| --- | --- |
| `01_eda.ipynb` | Exploratory analysis of the BAF Base dataset |
| `02_preprocessing.ipynb` | Feature selection and the time-based split: months 0–5 for training, 6–7 for testing |
| `03_training.ipynb` | Logistic regression and random forest with cross-validated tuning |
| `04_evaluation.ipynb` | Calibration, recall at 5% FPR, fairness by age, comparison of four candidates, and the final choice |
| `05_export.ipynb` | Export of model v1 with `metadata.json`, the golden examples, and the coefficients |
| `06_agent_simulation.ipynb` | Simulation of agent reputation and the risk bands |

The notebooks read the dataset from the project's S3 bucket
(`s3://sagemaker-salesmesh-myra/`), so re-running them needs read access to it.
The dataset itself is never committed (`data/` is ignored by Git).

| Path | Contents |
| --- | --- |
| `model_contract/` | Tracked copies of the contract: `metadata.json` (features, categories, ranges, threshold, metrics), `golden_examples.json`, `demo_sample.csv` (5,000 test rows for demo data), and `model-v1.sha256` |
| `src/` | One module per pipeline stage; each points to the notebook that implements it |
| `artifacts/` | Generated model output (ignored by Git) |

The exported model files are published as the GitHub Release `model-v1` and
downloaded with `.\scripts\dev.ps1 fetch-model`. See the
[model card](../docs/model-card.md) for the data, metrics, fairness, and
limitations, and [ML model service](../docs/ml-scoring.md) for how the backend
loads and uses the model.
