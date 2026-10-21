# ML Integration

How the trained fraud model is wired into SalesMesh, from a customer's
registration to an agent's reputation. For the model itself see the
[model card](model-card.md); for features and rules see
[ML model service](ml-scoring.md).

## Architecture

```mermaid
flowchart LR
    customer["Customer's phone<br/>/join/:code"] --> api
    admin["Admin workspace"] --> api
    agent["Agent workspace<br/>(link + customer names only)"] --> api
    client["Client workspace<br/>(quality figures)"] --> api

    subgraph api ["FastAPI backend"]
        join["api/join.py<br/>registration"]
        features["ml/features.py<br/>13 features"]
        scoring["services/scoring.py<br/>model + rules"]
        model["ml/model_service.py<br/>loaded once, checked"]
        explain["ml/explain.py<br/>reasons"]
        reviews["services/reviews.py"]
        reputation["services/reputation.py<br/>computed on read"]
        join --> features --> scoring
        scoring --> model
        scoring --> explain
    end

    files[["model.joblib<br/>metadata.json<br/>golden_examples.json<br/>(local folder or S3)"]] -->|startup:<br/>version + golden check| model
    api --> db[("PostgreSQL<br/>customers, risk_assessments,<br/>reviews, scoring_config")]
```

## Registration Flow

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant W as /join page (browser)
    participant J as POST /join/{code}/register
    participant F as Feature builder
    participant S as Scoring service
    participant M as Model service
    participant D as PostgreSQL
    actor A as Admin

    C->>W: Opens the agent's referral link
    W->>J: GET /join/{code}
    J-->>W: Agent display name (or "This link is not active")
    C->>W: Fills in the form and gives consent
    W->>J: Form + session minutes + device ID + user agent
    J->>J: Check link, rate limit, assisted mode
    J->>F: Registration data
    F->>D: Count emails per device (56 days) and per date of birth (28 days)
    F-->>J: 13 raw feature values
    J->>D: Save customer
    J->>S: score_customer(raw features)
    S->>S: Clip to training range, neutralise date-of-birth count
    S->>M: predict_probability
    M-->>S: Probability
    S->>S: Flag if probability >= 0.035 or a rule fires
    S->>D: Save risk assessment (probability, reasons, raw snapshot)
    S->>D: Status verified (not flagged) or pending_review (flagged)
    J-->>W: "Registration received" (never the score)

    A->>D: Review queue: flagged, unreviewed assessments
    A->>D: Confirm real (verified) or confirm fake (rejected), audited
    A->>D: Agent ranking: reputation computed from statuses on read
```

## Who Sees What

| Role | Sees | Never sees |
| --- | --- | --- |
| Customer | "Registration received" | Probability, flag, status, reasons |
| Agent | Own referral link; names, dates, and assisted flag of own customers | Customer status, probability, reasons, own reputation |
| Client | Registrations, confirmed fake % (decided by a reviewer), count under review, monthly trend for their agents | Model flags, probabilities, reasons, features |
| Admin | Everything above, plus probabilities, reasons, raw features, reputations, settings, model status | — |

## Startup and Safety Checks

1. The model files come from `MODEL_SOURCE` (local folder or S3).
2. The scikit-learn version must match `metadata.json`, or the model is not
   unpickled.
3. The 20 golden examples must match within 1e-5.
4. If any check fails, `/health` reports `model: failed` and registrations
   return 503 without saving anything. A failed reload keeps the working model.
5. The active version is recorded in `model_versions`, and every assessment
   stores the version that produced it.

## Demo Data

`.\scripts\dev.ps1 seed-demo` creates a demo admin, 3 clients, and 40 agents
(4 fraudulent) on `@demo.example.com`, all verified, approved, and active,
with `DEMO_PASSWORD` from `.env`. About 3,300 rows of
`ml/model_contract/demo_sample.csv` become customers spread over the last 12
months.

- **Demo-only bypass:** the 13 feature values come straight from the CSV
  instead of the feature builder, because the BAF rows already are feature
  values. Names, emails, phone numbers, and dates of birth are invented by
  Faker for display.
- Every customer is scored by the same `score_customer()` as a live
  registration. About 10% are marked assisted, with the same device features
  set to missing.
- Flags older than 60 days are reviewed automatically by the demo admin from
  the dataset label (`fraud_bool` 1 is confirmed fake, 0 confirmed real, note
  "Demo review based on dataset label") through the same review service as
  the API. Newer flags stay pending for a live review during a demonstration.
  `fraud_bool` is never stored.
- The command runs in one transaction, adds nothing if demo data exists, and
  prints the demo logins. `.\scripts\dev.ps1 reset-demo` deletes only demo
  users and their customers.
- The device rule never fires on demo rows, because no BAF row has more than
  2 emails per device. Register 3 different emails from one browser on a
  `/join` link to show it live.

## Code Map

| Concern | File |
| --- | --- |
| Model loading, version and golden checks | `backend/app/ml/model_service.py`, `model_source.py` |
| Feature builder | `backend/app/ml/features.py` |
| Reasons | `backend/app/ml/explain.py` |
| Scoring with rules | `backend/app/services/scoring.py` |
| Public registration | `backend/app/api/join.py`, `services/registration.py` |
| Reviews | `backend/app/services/reviews.py` |
| Reputation | `backend/app/services/reputation.py` |
| Demo data | `backend/app/demo.py` |
| Tables | `backend/app/models/`, migrations `0003` and `0004` |
| End-to-end test | `backend/tests/test_end_to_end.py` |
