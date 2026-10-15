# ML Model Service

The backend serves the trained fake-customer detector: `v1`, a calibrated
logistic regression trained on the BAF Base dataset. The training work in
`ml/notebooks/` is finished and is not changed by the backend. This page
describes how the backend loads the model and checks it before using it.
Features, scoring endpoints, and reputation are added in later phases.

## Model Files

| File | Purpose |
| --- | --- |
| `model.joblib` | scikit-learn `CalibratedClassifierCV` (sigmoid) wrapping `Pipeline(prep, model)`. All preprocessing is inside it. |
| `metadata.json` | Model contract: feature order, categories, threshold (0.035), `sklearn_version`, and test metrics |
| `golden_examples.json` | 20 inputs with the probabilities the model produced at export time |

Copies of the contract files are tracked in `ml/model_contract/`. The model
files themselves live in `backend/models/v1/`, which Git ignores. Docker
Compose mounts that folder read-only at `/app/models`, so the model is never
baked into an image.

## Loading and Checks

[`backend/app/ml/model_service.py`](../backend/app/ml/model_service.py) loads
the model once at startup and keeps it in memory:

```mermaid
flowchart TD
    start([API startup]) --> source{MODEL_SOURCE}
    source -- local --> folder[Read MODEL_DIR]
    source -- s3 --> s3[Download from S3<br/>to a temporary folder]
    s3 --> folder
    folder --> version{metadata sklearn_version<br/>== installed version?}
    version -- no --> failed[status: failed<br/>model not unpickled]
    version -- yes --> load[Unpickle model.joblib]
    load --> golden{All 20 golden examples<br/>within 1e-6?}
    golden -- no --> failed
    golden -- yes --> ok[status: ok<br/>predictions allowed]
```

- **Version check first.** A pickle saved with another scikit-learn version
  can fail or silently change predictions, so `model.joblib` is only unpickled
  when the versions match. `requirements.txt` pins `scikit-learn==1.7.2`, and
  also numpy, pandas, and joblib at the versions the golden check passed with.
- **Golden check.** Each example is scored one row at a time through
  `predict_probability`, the same function that will score real customers.
- **Failure is safe.** A failed load never crashes the API. The state becomes
  `failed`, the reason is kept, and `ModelService.predict_probability` raises
  `ModelUnavailableError`.
- **S3 source.** [`model_source.py`](../backend/app/ml/model_source.py)
  downloads the files with boto3. Use read-only credentials and a bucket only
  you can write to: unpickling a file runs code from it.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `MODEL_SOURCE` | `local` | `local` or `s3` |
| `MODEL_DIR` | `models/v1` | Local folder; relative paths start from `backend/` |
| `MODEL_S3_BUCKET` | none | Required when `MODEL_SOURCE=s3` |
| `MODEL_S3_PREFIX` | `models/final/v1` | Key prefix of the three files |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | none | Optional; empty values use the default AWS credential chain |

## Status Endpoints

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /health` | Public | `model: ok/failed` and `model_error`. A failed model gives HTTP 200 with `status: degraded`, so an admin can still sign in; only a database failure gives 503. |
| `GET /admin/model` | Admin | Status, error, source, load time, model name/version/type, scikit-learn version, threshold, test metrics, and golden-check results |

## Tests

`backend/tests/test_model_service.py` uses a small fake model to test version
mismatch, golden-check failure, NaN results, feature-name validation, missing
files, and S3 downloads, so these tests run in CI. The golden test on the real
model and the startup test are skipped when `backend/models/v1/model.joblib` is
absent, which is always the case in GitHub Actions because model files are not
committed.
