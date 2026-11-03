# Run Record

This file records how model v1 was built on SageMaker, and the v1.3.0
comparison that checks that choice. Model v1, its threshold, its features, and
the notebooks are unchanged.

## Summary

- **Model v1 stays deployed.** Tree models scored slightly higher, but they were
  less fair by age, far larger, and harder to explain to a reviewer.
- **The original threshold was chosen on the test months.** The deployed
  threshold 0.035 came from months 6-7, the same months used to report model
  v1's test metrics. Those test metrics are therefore slightly optimistic.
- **The effect is small.** A threshold chosen without the test months gives
  recall 32.9% against the published 34.4%, at a false-positive rate of 4.6%
  against 5.0%.

### Three sets of test-month figures

| Figures | Threshold | Recall | Precision | FPR |
| --- | --- | --- | --- | --- |
| Published (`metadata.json`) | 0.035 | 34.4% | 8.9% | 5.0% |
| Validation threshold | 0.0356 | 32.9% | 9.3% | 4.6% |
| Deployed pipeline | 0.035 | 29.3% | 9.3% | 4.1% |

- **Published:** model v1 on all 13 features, at a threshold chosen on the same
  test months, so slightly optimistic.
- **Validation threshold:** a model fitted on months 0-4, with the threshold
  chosen on month 5; the estimate without the test-month leak.
- **Deployed pipeline:** what SalesMesh sends the model, with values clipped to
  the training range and the date-of-birth count sent as missing
  (`ml/assisted_withholding.py`, `baf_test_months.as_entered`).

Assisted registrations have their own threshold, 0.008039, chosen the same way
with the four device features withheld (`ml/assisted_threshold.py`; see the
[model card](../docs/model-card.md#assisted-registrations-v130-check)).

## SageMaker Run (model v1)

Model v1 was built with notebooks `01` to `06` on Amazon SageMaker. They read
`Base.csv` from `s3://sagemaker-salesmesh-myra/`.

| Step | Notebook | What was done |
| --- | --- | --- |
| Prepare | `02_preprocessing` | Selected columns, treated negative values as missing, split months 0-5 from 6-7 |
| Train | `03_training` | Five-fold grid search on PR-AUC for logistic regression and random forest |
| Evaluate | `04_evaluation` | Sigmoid calibration, four candidates, fairness by age, final choice, threshold |
| Export | `05_export` | `model.joblib`, `metadata.json`, golden examples, coefficients |
| Simulate | `06_agent_simulation` | Agent reputation and risk bands |

Known from the saved files: scikit-learn 1.7.2 (`metadata.json`), notebook
kernel Python 3.12.14 (`05_export.ipynb`), and export date 2026-10-15.

### To be filled in by the developer

Take these from SageMaker. Do not include keys or account secrets.

| Item | Value |
| --- | --- |
| SageMaker instance type | _to fill in_ |
| Region | _to fill in_ |
| Image or kernel name | _to fill in_ |
| numpy, pandas, joblib, and scipy versions | _to fill in_ |
| Dates of the notebook runs | _to fill in_ |
| SHA-256 of `raw/Base.csv` in S3 | _to fill in_ |
| Approximate training cost or duration | _to fill in_ |

## Comparison Run (v1.3.0)

Results are in [results/v1.3.0](results/v1.3.0): `comparison.csv`,
`comparison.json`, two charts, and `run_record.json`, which holds the commit,
dataset hash, package versions, parameters, seed, date, and machine.

| Item | Value |
| --- | --- |
| Date | 2026-11-02 |
| Commit | `d57815f` |
| Dataset | `Base.csv`, SHA-256 `7bf10a37ce07e72e14c1b09e5efee3d27261baff4facc7da767b0474dcf9b809` |
| Rows | 1,000,000, all used, with no subsample for any model |
| Machine | Windows 11 laptop, 12 logical CPUs, 7.4 GB RAM |
| Python and packages | Python 3.14.3, scikit-learn 1.7.2, numpy 2.5.4, pandas 3.0.6, joblib 1.6.0 |
| Seed | 42 |

To repeat it, keeping `Base.csv` outside the repository:

```powershell
python -m venv ml\.venv
ml\.venv\Scripts\python.exe -m pip install -r ml\requirements-evidence.txt
ml\.venv\Scripts\python.exe ml\compare_models.py --data C:\path\to\Base.csv --out ml\results\v1.3.0
```

`--smoke` uses every 20th row and tiny models to test the script. Its figures are
not evidence.

### Checking the run against SageMaker

The script scored the deployed `model.joblib` on the local dataset, and its
SHA-256 matched `model_contract/model-v1.sha256`.

- The split gave 794,989 training rows and 205,011 test rows, as published.
- ROC-AUC was 0.8165 and recall, precision, and the FPR ratio matched the
  published figures at the unrounded threshold (989 true positives, 10,069 false
  positives).
- Refitting the same setup locally gave probabilities within 1.1e-12 of the
  deployed model.
- A second full run gave identical results apart from training time.

The local data and method therefore match the SageMaker run.

### Results on test months 6-7

The **original** columns use the threshold giving 5% FPR on the test months, the
method used for model v1. The **validation** columns fit on months 0-4, choose
the 5% FPR threshold on month 5, and then measure on months 6-7, so the test
months play no part. This was done for every model.

| Model | ROC-AUC | Recall, original | Recall, validation | Precision, original | Precision, validation | FPR, validation | FPR ratio, original | FPR ratio, validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dummy (prior) | 0.500 | 0.0% | 0.0% | none | none | 0.0% | none | none |
| **Calibrated LR (model v1 setup)** | **0.817** | **34.4%** | **32.9%** | **8.9%** | **9.3%** | **4.6%** | **0.474** | **0.468** |
| Random forest | 0.820 | 35.3% | 32.0% | 9.1% | 9.4% | 4.4% | 0.415 | 0.408 |
| Gradient boosting | 0.825 | 35.7% | 34.3% | 9.2% | 9.3% | 4.8% | 0.389 | 0.383 |

The dummy flags nobody, so it has no precision or FPR ratio. ROC-AUC is from the
fit on months 0-5. The FPR ratio is the lower age group's false-positive rate
divided by the higher one's, so 1.0 would be equal treatment.

| Model | Training time, months 0-5 | Model size |
| --- | --- | --- |
| Dummy (prior) | 2.3 s | 4.2 KB |
| Calibrated LR (model v1 setup) | 13.2 s | 6.7 KB |
| Random forest | 37.4 s | 15.1 MB |
| Gradient boosting | 20.3 s | 739.9 KB |

Times are from one run on this laptop, and the three fitted models have different
amounts of tuning behind them:

- **Calibrated LR:** model v1's settings, tuned in notebook 03.
- **Random forest:** the notebook's best settings, tuned with `customer_age`
  included (150 trees, depth 24, minimum leaf 50). It is uncalibrated.
- **Gradient boosting:** scikit-learn's histogram model with 200 rounds and
  default settings otherwise. It is not tuned and uncalibrated.

The ranking metrics above do not depend on calibration. The fixed threshold 0.035
applies only to the calibrated model, so tree models are not measured at it.

### Deployed threshold

| Threshold | Chosen on | Recall | Precision | FPR | FPR ratio | True positives | False positives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.03498 (unrounded, published metrics) | Test months | 34.4% | 8.9% | 4.98% | 0.474 | 989 | 10,069 |
| 0.035 (deployed) | Test months, then rounded | 34.3% | 8.9% | 4.98% | 0.474 | 988 | 10,057 |
| 0.0356 (validation, model fit on months 0-4) | Month 5 | 32.9% | 9.3% | 4.59% | 0.468 | 947 | 9,279 |

The original threshold 0.035 was chosen on the test months. A threshold chosen
that way can look better than it would on unseen data. The validation threshold
removes that leak: it came out almost the same (0.0356), recall fell by 1.5
points, and the false-positive rate stayed under the 5% target. 0.035 remains
deployed, and the validation row is the fairer estimate of performance.

The validation row also comes from a model trained on one month less, so a small
part of the difference may come from that.

### Decision: keep model v1

Gradient boosting had the highest ROC-AUC and recall, and it is recorded here as
the best scorer. Model v1 is kept because:

- **Fairness:** its FPR ratio is the best of the three (0.474 against 0.415 and
  0.389). The gain from the tree models came with a worse gap between age groups.
- **Small gain:** gradient boosting found 1.4 more points of recall at the
  validation threshold, and precision was the same at about 9%. About 9 in 10
  flags stay genuine customers whichever model is used, and a person reviews
  every flag.
- **Explainability:** the top three reasons shown to a reviewer come directly
  from model v1's coefficients. A tree model would need a different method.
- **Size and scope:** it is 6.7 KB against 740 KB and 15.1 MB, and v1.3.0 adds
  evidence, not new scoring.

These results are not a reason to believe the tree models could not do better:
gradient boosting was untuned. BAF is also bank data, so the figures describe
that setting, not SalesMesh's customers (see the
[model card](../docs/model-card.md)).
