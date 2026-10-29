# Limitations and Future Work

SalesMesh is a working prototype for a final-year project. This page lists
what it deliberately does not do yet and what should come next. Limitations of
the model itself (data, fairness, precision, drift) are in the
[model card](model-card.md#limitations).

## Current Limitations

| Area | Limitation |
| --- | --- |
| Email | Firebase sends the authentication emails from its own address, so they may land in spam; the free Spark plan limits how many it sends per day. The email check refuses only disposable and mail-less domains; it cannot tell whether a mailbox exists |
| Authentication | Deactivating a user only in the Firebase console does not end a running SalesMesh session (use User management). Agents and clients have no second factor; only admins use TOTP |
| Deployment | Development setup only (Docker Compose on one machine, plain HTTP). In LAN mode only the public `/join` page works on a phone: Firebase sign-in needs an authorized domain such as `localhost`, and browsers drop the `Secure` refresh cookie on plain HTTP |
| Decisions | A review is final: agents and customers cannot appeal a decision |
| Country check | `foreign_request` is always missing, because no IP-to-country provider is configured |
| Device signal | The device ID is kept in the browser's `localStorage`. Clearing it or using a private window gives a new ID, so the device rule is a signal, not proof |
| Rate limiting | Limited per IP address; offices or mobile networks that share one public IP reach the limit sooner |
| Agents and clients | Each agent works for at most one client |
| Data retention | Customers can be erased on request, but there is no automatic retention period |
| Monitoring | Monthly drift monitoring on the Model page only; no metrics system or alerts |
| Demo data | The demo uses real BAF test rows with invented identities, and older demo flags are reviewed from the dataset label, not by a person. All demo reviews carry the seed time, so the demo's time-to-review and reputation trend are not realistic (see the model card) |
| Historical KPIs | Reputation at a past month end uses today's p0 and k (settings changes are not versioned), and erased customers leave earlier months too |
| Integration API | The reputation API needs an admin token; there is no service account for unattended module-to-module calls |
| Reports | The client customer CSV is the only file export; KPI tables are on screen only. Agents are benchmarked against the network, not clients against each other |
| Fraud patterns | Collusion is detected only as one device registering many emails |
| Audit log | Entries cannot be changed through the application, but the database is not tamper-proof; routine admin page views are not logged |

The [SRS traceability](srs-traceability.md) table lists which requirements
are met, partly met, or integration points for other modules.

## Future Work

### Authentication follow-ups

Firebase Authentication, Google sign-in, admin TOTP, and the MX and
disposable-domain checks were added in v1.1.0 (see
[Authentication](authentication.md)). Next steps: a custom email domain for
Firebase's emails (better delivery), an optional second factor for agents and
clients, and asking Firebase about disabled users at each session refresh.

### Agent appeals

Let an agent contest a confirmed-fake decision, with a second review by a
different admin and both decisions kept in the audit log. Customers should
have the same route through the privacy contact.

### HTTPS and deployment

Deploy behind HTTPS with a reverse proxy, managed secrets instead of `.env`,
database backups, and separate production settings (allowed origin, cookie
domain, log level). HTTPS also removes the LAN cookie limitation.

### IP-to-country lookup

Plug a real provider (for example an offline GeoLite2 database) into the
replaceable `CountryLookup` interface in `backend/app/services/geoip.py`, so
`foreign_request` gets a value.

### Retraining on reviewed SalesMesh labels

Every review records a human decision (confirmed real or fake). Once enough
reviewed SalesMesh registrations exist, retrain and recalibrate on them
instead of BAF, re-check fairness, re-export the model with new golden
examples and checksums, and publish it as `model-v2`. The monitoring card shows
when the flag rate has drifted away from p0.

### Agents working for several clients

Replace the single `client_id` on the agent profile with an agent–client link
table, so an agent can work for several clients and each client sees only the
registrations made for them.

### Commission and payout module

Use the eligibility input (`GET /admin/eligibility`) to calculate
commissions, and show agents their payout status for eligible customers.
This gives agents useful feedback without exposing their reputation, scores,
or which customers were flagged.

### Service account for the integration API

Give other modules their own credentials and a service role for
`/api/v1`, instead of an admin token, with its own rate limit and audit
actor.

### Reproducible training with a SageMaker training job

The notebooks are run by hand and read the dataset from S3. Packaging
preprocessing, training, evaluation, and export as a SageMaker training job
(or another scripted pipeline) would make model versions reproducible and
would record the exact data, code, and parameters behind each export.
