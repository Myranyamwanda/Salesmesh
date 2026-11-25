# Failure Scenarios

How SalesMesh behaves when a part it depends on fails. In every case the user
sees what failed and what to do next, never "Something went wrong", and a
request that never answers ends in an error after 20 seconds instead of a
spinner that never stops.

## Summary

| Failure | What the user sees | What is protected | Evidence |
| --- | --- | --- | --- |
| Database unreachable | API 503 `database_unavailable`: "SalesMesh cannot reach its database right now. Try again in a few minutes." `/health` returns 503 | Nothing half-saved: each request is one transaction | `test_a_lost_database_gets_a_specific_503`; drill |
| Backend stopped or restarting | "Cannot reach SalesMesh. Check your connection and try again. If you are online, the service may be restarting." | The `/join` form keeps what the customer typed | `errors.test.ts`, `JoinPage.test.tsx`; drill |
| Server too slow | "The server took too long to answer. Check your connection and try again." after 20 seconds (model reload: 120 seconds) | Retrying a registration is safe (see below) | `errors.test.ts` |
| Firebase unreachable | "The sign-in service is unavailable; try again shortly" (503); Firebase's own network error has its own message | Nothing created, no audit noise, no lockout counted | `test_firebase_outage_*` |
| DNS unreachable during email checks | Nothing: the email is accepted and the failure logged | A DNS outage cannot block registrations | `test_dns_failure_is_logged` |
| Model files missing | `/join`: "Registration is temporarily unavailable. Please try again later." Admins: the Model page and `/health` show "Model file not found: metadata.json" | No customer saved without a score | `test_model_unavailable_saves_nothing`; drill |
| Model file changed (checksum) | As above, with "model.joblib does not match its recorded checksum" | A changed file is never unpickled, because unpickling runs code | `test_a_changed_model_file_is_never_unpickled`; drill |
| Unexpected server error | 500: "The server could not finish this request. Try again. If it keeps happening, give an administrator this reference: <request ID>" | No internal detail is shown | `test_unexpected_errors_and_cors` |
| Invalid request | 422 naming the field, such as "Check the consent field." or "The request body is not valid JSON." | Input values are never echoed | `test_invalid_forms_name_the_problem` |

## Registering Twice

The `/join` page creates one random `submission_id` when it opens and sends it
with every attempt. The backend stores it on the customer (`customers.submission_id`,
unique, migration 0009). A repeat with the same ID, from a double click, a retry
after a lost response, or two requests at once, returns the first registration's
reference and creates nothing. The button is also disabled while a request is
being sent.

A repeat still gets its reference while the model is down, because the
registration already exists. If a customer edits the form after a registration
was saved and submits again from the same page, they get the first reference;
opening the link again starts a new form.

## Checks Before Destructive Actions

| Action | Confirmation |
| --- | --- |
| Erase customer data | Type the customer's email, with warnings for confirmed-fake and pending customers |
| Deactivate an account | Dialog saying the user is signed out, cannot sign in, and an agent's link stops working; reactivating needs no confirmation |
| Reset an admin's authenticator | Not in the web app: only the `reset-mfa` terminal command |

## Messages Next to the Field

On `/join`, a refused email address ("Use a permanent email address") appears
under the email field and moves focus there, as it already did on agent
registration. Pages that fail to load now say what failed and why, for example
"Agents could not be loaded. Cannot reach SalesMesh. …".

A `/join` link that cannot be checked because of an outage says "We could not
check this link" with a **Try again** button. Only a 404 shows "This link is not
active", so an outage is never presented to customers as a dead link.

## Drill (2026-11-03)

Run on a throwaway Compose stack (`-p salesmesh-preview`, its own empty
database), from branch `feature/robustness`. The developer's database was not
used.

| Step | Result |
| --- | --- |
| Normal `/health` | 200, database ok, model ok |
| Stop PostgreSQL, call `/health` | 503 `database_unavailable` |
| Stop PostgreSQL, call `/join/{code}` and `POST /join/{code}/register` | 503 "SalesMesh cannot reach its database right now. Try again in a few minutes." |
| Start PostgreSQL | `/health` 200 again without restarting the backend |
| Stop the backend | Connection refused |
| Start the backend | `/health` 200 again |
| Load with `MODEL_DIR` pointing at a missing folder | `failed`, "Model file not found: metadata.json" |
| Load a copy with one byte added to `model.joblib` | `failed`, "model.joblib does not match its recorded checksum" |

The drill also found a bug: an invalid JSON body produced "Check the 1 field.",
because the error location held a position instead of a field name. It now
says "The request body is not valid JSON.", and a test covers it.
