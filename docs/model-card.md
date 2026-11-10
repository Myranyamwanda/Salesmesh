# Model Card: SalesMesh Fake-Customer Detector (v2)

## Summary

| | |
| --- | --- |
| Name and version | `salesmesh-fake-user-detector`, `v2` (since v1.4.0; `v1` kept for rollback) |
| Purpose | Estimate the probability that a customer registered by a sales agent is fake, so that suspicious registrations are reviewed by a person and agents who register many fake customers can be identified |
| Model | Logistic regression (C = 0.01, `class_weight="balanced"`) with sigmoid calibration (`CalibratedClassifierCV`, `ensemble=False`); all preprocessing inside one scikit-learn pipeline |
| Library | scikit-learn 1.7.2 (the API refuses to load the model with another version) |
| Output | Probability of a fake customer; flagged at or above the threshold 0.03539 (assisted registrations: 0.014058) |
| Intended users | SalesMesh administrators, as decision support; never shown to agents or customers |
| Training | Model v1: `ml/notebooks/01`–`06`. Model v2: `ml/train_v2.py`, the same method without two features. Contracts in `ml/model_contract/v1/` and `ml/model_contract/v2/` |

## Model v2 (v1.4.0)

Model v2 is model v1 without two features, after supervisor feedback and an
ablation study ([`ml/results/v1.4.0/ablation.md`](../ml/results/v1.4.0/ablation.md)):

- **`name_email_similarity`** was not valid for SalesMesh users: many genuine
  people use emails unrelated to their name. In the BAF test months, model v1
  flagged honest applicants with a similarity below 0.2 at a false-positive
  rate of 8.6%, against 3.4% for everyone else, and they made up 42% of all
  honest flags. Without the feature their rate is 5.2% against 4.6%. SalesMesh
  no longer computes or stores the similarity (data minimisation), and our
  difflib formula was never the unpublished BAF formula anyway.
- **`keep_alive_session`** came from a "Keep me signed in" box on `/join`, which
  makes little sense on a one-time registration form and has been removed.
  Removing the box but keeping the feature would give every customer the same
  imputed value, so the model was retrained instead.

Everything else is unchanged: the pipeline, `C=0.01`, balanced class weights,
sigmoid calibration, the BAF preparation, training on months 0-5, and the
20 golden examples chosen as in notebook 05 (`ml/train_v2.py`).

**Thresholds.** Both are the last ROC point at or below 5% FPR on month 5, so the
test months play no part:

- **Standard, 0.03539:** chosen as in v1.3.0, from a model fitted on months
  0-4. On the test months, model v2 at this threshold has a 5.02% FPR.
- **Assisted, 0.014058:** chosen with model v2 itself on month 5 with the
  three device features withheld. The v1.3.0 method (a months 0-4 model) gave
  0.012417, but with the device features withheld every score falls in a
  narrow band, so the small calibration difference between the two fits moves
  the whole band across the threshold. At 0.012417, model v2 flagged 12.5% of
  genuine assisted test applicants (v1 had the same effect, at 6.7%). At
  0.014058 the test FPR is 4.2% and recall is 12.9%, the same recall as the
  months 0-4 model at its own threshold. This reverses the v1.3.0 choice
  below, because the gap is now too large to accept. Migration 0011 sets the
  new value unless an administrator has changed it.

### v1 against v2 on test months 6-7

The fair comparison uses the validation method for both: a model fitted on
months 0-4 with the threshold chosen on month 5 (`ablation.json`).

| Model | Features | ROC-AUC | PR-AUC | Brier | Recall | Precision | FPR | FPR ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | 13 | 0.8165 | 0.0826 | 0.0134 | 32.9% | 9.3% | 4.6% | 0.468 |
| **v2** | **11** | **0.7938** | **0.0684** | **0.0135** | **29.5%** | **8.1%** | **4.7%** | **0.510** |

The deployed models, fitted on months 0-5, at their deployed thresholds:

| Model, threshold | Inputs | Recall | Precision | FPR | FPR ratio |
| --- | --- | --- | --- | --- | --- |
| v1, 0.035 | Raw (published; threshold chosen on the test months) | 34.4% | 8.9% | 5.0% | 0.474 |
| **v2, 0.03539** | **Raw (`metadata.json` `metrics_test`)** | **30.6%** | **8.0%** | **5.0%** | **0.508** |
| v1, 0.035 | Deployed pipeline (clipped, date-of-birth count missing) | 29.3% | 9.3% | 4.1% | 0.629 |
| **v2, 0.03539** | **Deployed pipeline** | **27.1%** | **7.8%** | **4.6%** | **0.769** |
| v1, 0.008039 | Assisted (4 features withheld) | 24.3% | 4.9% | 6.7% | 0.96 |
| **v2, 0.014058** | **Assisted (3 features withheld)** | **12.9%** | **4.2%** | **4.2%** | **0.77** |

The cost is about 3 points of recall and 1 point of precision; the gain is
fairer treatment of users whose email does not contain their name, and a
better age FPR ratio. In assisted mode the cost is larger: v2's flags find
about half as much assisted fraud (see
[Assisted registrations with model v2](#assisted-registrations-with-model-v2)).

**History and rollback.** Assessments scored by v1 keep their 13-value
snapshot, threshold, and reasons; the review dialog shows feature effects only
for the model that is loaded, so v1 assessments show them as unavailable. The
`model-v1` release, its checksums, and `ml/model_contract/v1/` stay, so the
v1.3.0-rc1 tag with model v1 can be redeployed (see
[deployment](deployment.md#rolling-back-to-the-previous-tag)).

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
- **Features:** model v1 used 13 BAF columns, chosen because SalesMesh can
  produce them from a registration (see [ML model service](ml-scoring.md));
  model v2 uses 11 of them.
  `customer_age` was removed for fairness. Velocity counts and `zip_count_4w`
  were removed because they are bank-scale counts with no added value here.

## Model Comparison (model v1)

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

## Test Metrics (model v1)

Model v2's are in [Model v2](#model-v2-v140) and its `metadata.json`.
From model v1's `metadata.json` `metrics_test`, at the threshold 0.035 (5% FPR):

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

**Threshold note.** The threshold 0.035 was chosen on the test months, the same
months as these metrics, so they are slightly optimistic. The deployed threshold
is unchanged. Three sets of figures describe the same model on test months 6-7:

| Figures | Threshold | Recall | Precision | FPR | What they show |
| --- | --- | --- | --- | --- | --- |
| Published (`metadata.json`) | 0.035 | 34.4% | 8.9% | 5.0% | The model on all 13 features, at a threshold chosen on these same months |
| Validation threshold | 0.0356 | 32.9% | 9.3% | 4.6% | A model fitted on months 0-4 at a threshold chosen on month 5: the estimate without the test-month leak |
| Deployed pipeline | 0.035 | 29.3% | 9.3% | 4.1% | What SalesMesh actually sends: values clipped to the training range and the date-of-birth count sent as missing |

**v1.3.0 comparison.** Random forest (ROC-AUC 0.820) and untuned gradient
boosting (0.825) scored slightly higher than model v1 (0.817), but with worse
FPR ratios (0.415 and 0.389 against 0.474). Model v1 was kept. The method,
results, and reasons are in the [run record](../ml/RUN_RECORD.md).

## How SalesMesh Uses the Model: Model + Rules

1. **Features.** Each registration is turned into the 11 features by
   `backend/app/ml/features.py`, with documented adaptations (for example the
   BAF home phone becomes an optional secondary phone).
2. **Clipping.** Numeric values are clipped to the training minimum and
   maximum before the model sees them, because a linear model extrapolates
   without limit. The stored snapshot keeps the raw values.
3. **Model.** The probability is compared with the threshold 0.03539, or
   0.014058 for an assisted registration.
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

With model v1 (v1.3.0; for model v2 see the
[demo check](#assisted-registrations-with-model-v2)), in the seeded demo
(3,388 customers), 6.3% of registrations were flagged,
close to the expected platform rate of 5.39%. After human review of flags and
audits older than 60 days, the five fraudulent agents had the five lowest
reputations (86.8-94.9) and the lowest honest agent had 95.2. The fifth, the
assisted-mode agent added in v1.3.0, is Low risk by reputation (94.9) and is
picked out by the assisted-share alert instead. Reviews that confirmed
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
- **Feature adaptations.** The home phone is mapped to a secondary phone, and
  `foreign_request` is always missing until an IP-to-country provider is
  configured. (Model v1 also used our own name–email similarity formula, as the
  BAF formula is not published; model v2 dropped the feature.)
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
- **Low precision.** Model v2 finds about 31% of fake applications at a 5%
  false-positive rate, with about 8% precision: most flagged customers are
  genuine. **Human review is
  required** for every flag, and the score must never be used to reject a
  customer automatically.
- **Assisted registrations are scored without three features.** An assisted
  registration sends its device and session features as missing, which lowers
  every score. They have their own threshold, random audits, and an alert per
  agent. With model v2 the flags alone find about 1 in 8 assisted fraud cases,
  so the audits and the assisted-share alert matter more. See
  [Assisted registrations with model v2](#assisted-registrations-with-model-v2).
- **Fairness.** Removing age improved the FPR ratio to 0.47 (0.51 for model v2)
  but did not reach equality, and other groups were not measured because BAF has no such
  attributes. Older applicants are still flagged about twice as often.

## Assisted Registrations (v1.3.0 check, model v1)

`ml/assisted_withholding.py` scores the same rows twice, as entered and with the
four features withheld, through the backend's own scoring code. It is read-only
and changes no model, threshold, or rule. Results are in
`ml/results/v1.3.0/assisted_withholding.json`.

| Data | Flag rate as entered | Flag rate withheld | Highest probability withheld | Mean probability change |
| --- | --- | --- | --- | --- |
| Demo customers (3,328, replayed from the seed) | 6.3% | 0.0% | 0.012 | -0.0069 (median -0.0013) |
| BAF test months (205,011 rows) | 4.4% | 0.0% | 0.0346 (threshold 0.035) | -0.0055 (median -0.0012) |

In the demo data itself, 0 of 309 assisted customers are flagged, against 193 of
3,019 (6.4%) others. Withholding lowers the score of about 4 in 5 rows, and on
average leaves 61% of the original probability.

The mean change in the logistic score per feature (BAF test months) explains
the direction:

| Withheld feature | Mean change | Why |
| --- | --- | --- |
| `device_distinct_emails_8w` | -0.89 | Imputed as 1 with a missing indicator, which the model reads as low risk |
| `keep_alive_session` | -0.29 | Imputed as the median (kept signed in), the low-risk value |
| `session_length_in_minutes` | +0.22 | The missing indicator adds +0.23 |
| `device_os` | +0.22 | No category, so the device term is zero |

The "Time spent on the form was not measured" reason comes from that +0.23. It
appears among the stored reasons of 194 of the 309 assisted demo customers (63%),
although none of them is flagged. It is an artefact of assisted mode, not a sign
of fraud.

What follows:

- **Fairness.** Assisted customers are not scored higher; the opposite holds.
  The review dialog used to label these features "Not used (assisted
  registration)", which was not accurate. It now shows each one's real
  direction, marked "withheld on an assisted registration, scored as
  missing", and marks the form-time reason as expected for assisted
  registrations.
- **Detection gap.** An agent could use assisted mode to keep fraudulent
  registrations below the threshold, and the device rule never fires in
  assisted mode. The admin Agents page shows each agent's assisted share; a
  high share is a reason to review that agent's registrations by hand.
- **Closed in v1.3.0.** See the safeguards below.

Three safeguards (v1.3.0) close that gap without changing the model, its
features, or the 0.035 threshold for other registrations:

1. **Assisted threshold.** An assisted registration is flagged at a probability
   of 0.008039 or more (`scoring_config.assisted_threshold`). Each assessment
   records which threshold was applied (`threshold_kind`), and the review dialog
   shows it.
2. **Random audit.** A share of the unflagged assisted registrations
   (`scoring_config.audit_share`, default 20% since v1.4.0, 10% before), chosen with Python's `secrets`
   module, goes to the review queue with the reason "Random audit (assisted
   registration)" and an **Audit** label. An audit is not a flag: it changes no
   status, reputation, flag rate, or eligibility unless a reviewer confirms the
   registration as fake, which then counts as usual.
3. **Assisted-share alert.** Admins see "High assisted share" next to an agent
   with at least `min_users_for_band` (30) registrations whose assisted share is
   more than `assisted_alert_multiple` (default 2) times the network's.

### Choosing the assisted threshold

`ml/assisted_threshold.py` uses the Phase 1 method: model v1's setup is fitted
on months 0-4, the four features are withheld, and the threshold giving a 5%
false-positive rate on month 5 is taken. Results are in
`ml/results/v1.3.0/assisted_threshold.json`.

| Assisted registrations, features withheld | Threshold | Recall | Precision | FPR | FPR ratio |
| --- | --- | --- | --- | --- | --- |
| Month 5 (where it was chosen) | 0.008039 | 22.3% | 5.1% | 5.0% | 0.90 |
| Test months 6-7, model fitted on months 0-4 | 0.008039 | 18.6% | 5.5% | 4.5% | 0.93 |
| Test months 6-7, deployed model v1 | 0.008039 | 24.3% | 4.9% | 6.7% | 0.96 |

- The month 0-4 model gives the clean estimate; the deployed model, fitted on
  months 0-5, scores slightly higher, so in use about 6.7% of genuine assisted
  customers are flagged rather than 5%. Choosing the threshold with the deployed
  model on month 5 would hit 5% exactly, but month 5 was part of its training,
  which is the leak Phase 1 removed.
- About 19 in 20 assisted flags are genuine customers, against about 9 in 10
  for other registrations, so the review queue gets proportionally more false
  alarms from assisted mode.
- The FPR ratio by age is close to 1 (0.96), because the withheld features carry
  much of the age difference.

The as-entered figures use the deployed pipeline (clipped values, date-of-birth
count sent as missing), so they are below the published test metrics: recall
29.3% at a 4.1% false-positive rate, against 34.4% at 5.0%.

## Assisted Registrations with Model v2

`ml/assisted_v2.py` scores the BAF test months with the device features
withheld through the deployed input rules, for both deployed models at their
assisted thresholds, and adds random audits. An audit sends a share of the
unflagged assisted registrations to a reviewer, so the figures are the
expected share of fraud and of genuine customers that reach a reviewer
(`ml/results/v1.4.0/assisted_v2.json`). Audits are not flags: an audited
customer's status does not change, so the cost of an audit is reviewer time.

| Model | Audit share | Fraud reviewed (recall) | Precision of reviews | Genuine reviewed (FPR) | Reviews per 1,000 assisted |
| --- | --- | --- | --- | --- | --- |
| v1, 0.008039 | none | 24.3% | 4.9% | 6.7% | 70 |
| v1, 0.008039 | 10% (v1.3.0 default) | 31.9% | 2.7% | 16.1% | 163 |
| v2, 0.014058 | none | 12.9% | 4.2% | 4.2% | 43 |
| v2, 0.014058 | 10% | 21.6% | 2.2% | 13.8% | 139 |
| v2, 0.014058 | 15% | 25.9% | 2.0% | 18.6% | 187 |
| v2, 0.014058 | 20% | 30.3% | 1.8% | 23.3% | 234 |

**Audit share: 20% since v1.4.0 (decided with the developer).** It brings
the share of assisted fraud that reaches a reviewer (30.3%) back close to model
v1 with 10% audits (31.9%), for about 71 more reviews per 1,000 assisted
registrations than v1 needed. Assisted registrations are about 10% of all
registrations, so that is about 7 more reviews per 1,000 registrations overall.
Migration 0011 sets it only where an administrator has not changed the v1.3.0
value; it stays editable in Settings (`audit_share`). The assisted threshold
stays 0.014058, keeping the 5% false-positive target.

**Demo check (seeded with model v2).** The demo was seeded into a throwaway
database with model v2 and the same fixed clock as the v1.3.0 check:

| Setting | Flagged | Four original fraudulent agents | Agent 41 (assisted abuser) | Lowest honest agent | Five fraudulent agents are the five lowest | Agent 41 alert |
| --- | --- | --- | --- | --- | --- | --- |
| v1 (v1.3.0) | 214 | 86.8-89.5 | 94.9, 3 flags | 95.2 | yes | yes |
| **v2 as released: threshold 0.014058, audits 20% (defaults)** | **219** | **87.7-90.4** | **97.8, 1 confirmed fake (audit)** | **95.3** | **no** | **yes** |
| v2, threshold 0.014058, audits 10% | 219 | 87.7-90.4 | 99.2, 0 flags | 95.3 | no | yes |
| v2, threshold 0.012417, audits 10% (not chosen) | 250 | 87.7-89.5 | 92.1, 5 flags | 95.3 | yes | yes |

With the released defaults, 61 assisted registrations are audited and 219
registrations flagged. The four original fraudulent agents remain the four
lowest (three High risk, one Watch). **Agent 41 is now detected by the
assisted-share alert and by the random audits, not by a low reputation**: v2's
assisted flags find little of its fraud, so its reputation stays Low risk
(97.8), and one of its audited registrations is confirmed fake. **Agent 39
stays the false-alarm example**: an honest agent with 8 of 38 registrations
assisted (21%, just over twice the network's 10%), so it gets the same alert
with no fraud behind it. The alert asks an administrator to look; it is not
evidence on its own.

The v1.3.0-method threshold 0.012417 would restore agent 41's low reputation,
but at the cost of flagging about 12.5% of genuine assisted customers instead
of 4.2%; the developer kept 0.014058.

## Reproducibility

- `ml/model_contract/v2/metadata.json` holds the feature order, categories,
  numeric ranges, thresholds, and metrics (`v1/` holds model v1's).
- `ml/model_contract/v2/golden_examples.json` holds 20 inputs with their expected
  probabilities. The API checks them at every start (tolerance 1e-5) and
  refuses to score if any differs.
