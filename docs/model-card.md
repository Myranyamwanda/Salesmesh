# Model Card: SalesMesh Fake-Customer Detector (v1)

## Summary

| | |
| --- | --- |
| Name and version | `salesmesh-fake-user-detector`, `v1` |
| Purpose | Estimate the probability that a customer registered by a sales agent is fake, so that suspicious registrations are reviewed by a person and agents who register many fake customers can be identified |
| Model | Logistic regression (C = 0.01, `class_weight="balanced"`) with sigmoid calibration (`CalibratedClassifierCV`, `ensemble=False`); all preprocessing inside one scikit-learn pipeline |
| Library | scikit-learn 1.7.2 (the API refuses to load the model with another version) |
| Output | Probability of a fake customer; flagged at or above the threshold 0.035 |
| Intended users | SalesMesh administrators, as decision support; never shown to agents or customers |
| Training notebooks | `ml/notebooks/01`–`06`; export contract in `ml/model_contract/` |

## Data

- **Source:** Bank Account Fraud (BAF) dataset suite, Base variant (NeurIPS
  2022). It is a large, privacy-preserving synthetic dataset of bank account
  applications with a label `fraud_bool`.
- **Citation and licence:** Jesus et al., "Turning the Tables: Biased,
  Imbalanced, Dynamic Tabular Datasets for ML Evaluation", NeurIPS 2022
  Datasets and Benchmarks. The dataset, and this model trained on it, are used
  under the dataset's non-commercial licence.
- **Split by time:** months 0–5 for training (794,989 rows) and months 6–7 for
  testing (205,011 rows), so the test imitates future applications.
- **Class balance:** about 1.4% fraud in the test months (2,878 of 205,011),
  which is why precision is low at any useful recall.
- **Features:** 13 BAF columns, chosen because SalesMesh can produce
  them from a registration (see [ML model service](ml-scoring.md)).
  `customer_age` was removed for fairness. Velocity counts and `zip_count_4w`
  were removed because they are bank-scale counts with no added value here.

## Model Comparison

From `ml/notebooks/04_evaluation.ipynb`, on the test months. "FPR ratio" is the
false-positive rate of applicants under 50 divided by that of applicants 50 or
older; 1.0 would be equal treatment.

| Model | Features | ROC-AUC | Recall at 5% FPR | Precision | FPR under 50 | FPR 50+ | FPR ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LR with age | 14 | 0.825 | 36.4% | 9.4% | 2.9% | 15.8% | 0.18 |
| RF with age | 14 | 0.826 | 35.1% | 9.5% | 3.1% | 13.3% | 0.24 |
| **LR without age (chosen)** | **13** | **0.817** | **34.4%** | **8.9%** | **4.2%** | **8.9%** | **0.47** |
| LR transfer-safe | 11 | 0.745 | 22.0% | 5.9% | 3.9% | 10.7% | 0.36 |

"Transfer-safe" also removed `phone_home_valid` and `device_os`, the two
features least likely to mean the same thing outside the BAF bank setting.

**Decision.** With age, the model wrongly flagged legitimate applicants aged 50
or more more than five times as often as younger ones (FPR ratio **0.18**).
Removing age raised the ratio to **0.47** and cut the older group's
false-positive rate from 15.8% to 8.9%, at a cost of about 2 percentage points
of recall. The random forest was no better than logistic regression and is
harder to explain. The transfer-safe model lost 12 points of recall, so the two
risky features were kept and treated as documented adaptations instead.

## Test Metrics (chosen model)

From `metadata.json` `metrics_test`, at the threshold 0.035 (5% FPR):

| Metric | Value | Metric | Value |
| --- | --- | --- | --- |
| ROC-AUC | 0.8165 | Accuracy | 0.9417 |
| PR-AUC | 0.0826 | Balanced accuracy | 0.6469 |
| Recall at 5% FPR | 0.3436 | Brier score | 0.0134 |
| Precision | 0.0894 | Mean probability | 0.0097 |
| False-positive rate | 0.0498 | FPR ratio (<50 / ≥50) | 0.474 |
| True positives | 989 | False positives | 10,069 |
| False negatives | 1,889 | True negatives | 192,064 |

At this threshold the model finds about a third of the fake applications and
about **9 in 10 flagged applications are genuine**. That is acceptable only
because every flag goes to a person.

## How SalesMesh Uses the Model: Model + Rules

1. **Features.** Each registration is turned into the 13 features by
   `backend/app/ml/features.py`, with documented adaptations (for example the
   BAF home phone becomes an optional secondary phone).
2. **Clipping.** Numeric values are clipped to the training minimum and
   maximum before the model sees them, because a linear model extrapolates
   without limit. The stored snapshot keeps the raw values.
3. **Model.** The probability is compared with the threshold 0.035.
4. **Rules.** Extreme values that clipping hides are handled by transparent
   rules. The device rule flags a registration when one device was used for at
   least `device_email_rule_min` (default 3) different emails in 8 weeks; the
   model never saw more than 2.
5. **Reasons.** The top three contributions (transformed value x coefficient)
   are shown in plain English. Each reason is labelled **Model** or **Rule**.
6. **Human review.** A flagged customer waits for an administrator to confirm
   it as real or fake.

## Agent Reputation

From `ml/notebooks/06_agent_simulation.ipynb`: 200 simulated agents (10
fraudulent with 40% fake customers, 50–300 customers each) built from the
test months.

```text
reputation = 100 * (1 - (flags + k * p0) / (n_users + k))    p0 = 0.0539, k = 10
```

- **Comparison with a simple formula.** Both formulas separated the groups in
  the base scenario, but the simple formula compressed all agents into about
  1.5 points, which an administrator cannot interpret; the smoothed formula
  spreads them over about 20 points. The simple mean-probability reputation
  ranged from 97.8 to 99.3; the smoothed reputation from 79.8 to 99.2 (honest
  mean 94.5, fraudulent mean 84.0). All 10 fraudulent agents were in the
  bottom 10.
- **Sensitivity.** Separation depends on how many fake customers an agent has
  and how many customers in total:

| Fake share of bad agents | Customers per agent | Mean AUC | Bad agents in bottom 10 (of 10) |
| --- | --- | --- | --- |
| 5% | 10–30 | 0.579 | 0.5 |
| 5% | 50–300 | 0.681 | 1.6 |
| 10% | 10–30 | 0.643 | 1.0 |
| 10% | 50–300 | 0.815 | 3.3 |
| 20% | 10–30 | 0.754 | 2.5 |
| 20% | 50–300 | 0.977 | 6.7 |
| 40% | 10–30 | 0.881 | 4.9 |
| 40% | 50–300 | 1.000 | 9.7 |

  Small or only slightly dishonest agents cannot be told apart reliably, which
  is why agents with fewer than 30 customers get "Insufficient data" instead of
  a band.
- **Bands.** The simulation proposed High risk below 90.5 and Watch below 92.2
  (the 2nd and 10th percentiles of honest agents); SalesMesh uses the rounded
  values 90 and 92, editable in Settings. In the simulation all 10 fraudulent
  agents were High risk, and of 190 honest agents 4 were High risk and 15
  Watch.

In the seeded demo (3,328 customers), 5.8% of registrations were flagged,
close to the expected platform rate of 5.39%. After human review of flags
older than 60 days, the four fraudulent agents had the four lowest reputations
(87.7-90.4) and the lowest honest agent had 95.2. Reviews that confirmed
customers as real removed false flags from honest agents, so human review
widened the separation between honest and fraudulent agents.

**Demo caveat for the KPI charts.** The seed spreads registrations over the
last 365 days but records every review at the moment it runs (flags older
than 60 days are reviewed then; newer ones stay pending). The monthly KPIs
therefore show (1) an average time to review that equals the cohort's age at
seeding, from about 11 months for the oldest month down to about 2 months,
and no reviews for the two newest months; and (2) reputations at earlier
month ends that count every demo flag as still waiting, so each agent's trend
steps up in the month the seed ran, when the confirmed-real reviews remove
false flags. Real reviews would take hours or days and would change the
trend gradually.

**Decision: agents cannot see their reputation.** Reputation is an admin-only
decision-support tool. Showing it, or even a customer's review status, would
let an agent learn which registrations get flagged and adjust to avoid
detection. Agents see their referral link, the names of the customers they
onboarded, a monthly standing label (New agent, Good standing, or Account
under review), and monthly totals of completed months. A future commission
module may show payout status to agents.

## Limitations

- **Not Kenyan data.** BAF is synthetic bank application data from another
  market. Real SalesMesh registrations will differ, and the model must be
  re-evaluated (and probably retrained) on labelled SalesMesh data.
- **Feature adaptations.** The home phone is mapped to a secondary phone, the
  name–email similarity formula is our own (the BAF formula is not published),
  and `foreign_request` is always missing until an IP-to-country provider is
  configured.
- **Date of birth count is neutralised.** In BAF,
  `date_of_birth_distinct_emails_4w` is a bank-scale count (mean 9.5 for
  legitimate applications, 7.4 for fraud) with a negative coefficient. On a
  small platform almost every value is 0, which the model would read as high
  risk for every customer. The model receives missing instead (imputed with
  the training median, with no missing-value indicator), so the feature is
  neutral. The real count is still stored for later analysis.
- **Drift.** Fraud patterns change. The time split shows performance one to two
  months ahead only; recall, precision, and the flag rate should be monitored.
  The admin Model page shows the monthly model flag rate and mean probability
  against p0; a sustained difference from p0 can indicate drift, and the
  threshold or p0 should then be recalibrated with reviewed cases.
- **Low precision.** About 34% recall at a 5% false-positive rate, with about
  9% precision: most flagged customers are genuine. **Human review is
  required** for every flag, and the score must never be used to reject a
  customer automatically.
- **Fairness.** Removing age improved the FPR ratio to 0.47 but did not reach
  equality, and other groups were not measured because BAF has no such
  attributes. Older applicants are still flagged about twice as often.

## Reproducibility

- `ml/model_contract/metadata.json` holds the feature order, categories,
  numeric ranges, threshold, and metrics.
- `ml/model_contract/golden_examples.json` holds 20 inputs with their expected
  probabilities. The API checks them at every start (tolerance 1e-5) and
  refuses to score if any differs.
