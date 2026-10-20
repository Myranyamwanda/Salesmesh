# Limitations and Future Work

SalesMesh is a working prototype for a final-year project. This page lists
what it deliberately does not do yet and what should come next. Limitations of
the model itself (data, fairness, precision, drift) are in the
[model card](model-card.md#limitations).

## Current Limitations

| Area | Limitation |
| --- | --- |
| Email | Emails are written to the API log, not sent. Customer email addresses are not checked (no MX or disposable-address check) |
| Authentication | Password sign-in only: no managed identity provider, no social sign-in, and no multi-factor authentication for admins |
| Deployment | Development setup only (Docker Compose on one machine, plain HTTP). In LAN mode, browsers drop the `Secure` refresh cookie, so signing in on a phone lasts only until a reload |
| Decisions | A review is final: agents and customers cannot appeal a decision |
| Country check | `foreign_request` is always missing, because no IP-to-country provider is configured |
| Device signal | The device ID is kept in the browser's `localStorage`. Clearing it or using a private window gives a new ID, so the device rule is a signal, not proof |
| Rate limiting | Limited per IP address; offices or mobile networks that share one public IP reach the limit sooner |
| Agents and clients | Each agent works for at most one client |
| Data retention | Customers can be erased on request, but there is no automatic retention period |
| Monitoring | Monthly drift monitoring on the Model page only; no metrics system or alerts |
| Demo data | The demo uses real BAF test rows with invented identities, and older demo flags are reviewed from the dataset label, not by a person |

## Future Work

### Managed authentication and real email delivery

Replace the development email log with a transactional email service, and
consider a managed identity provider such as Firebase Authentication for
sign-in, Google sign-in, and admin multi-factor authentication (TOTP). Check
customer email addresses at registration (MX record and disposable-domain
checks) as an extra onboarding signal.

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

Show agents their payout status for verified customers. This gives agents
useful feedback without exposing their reputation, scores, or which
customers were flagged.

### Reproducible training with a SageMaker training job

The notebooks are run by hand and read the dataset from S3. Packaging
preprocessing, training, evaluation, and export as a SageMaker training job
(or another scripted pipeline) would make model versions reproducible and
would record the exact data, code, and parameters behind each export.
