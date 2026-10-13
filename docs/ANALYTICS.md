# Analytics: legitimate-interest assessment

Last reviewed: 2026-10-13. Owner: site operator (Jonesy). Review yearly or when the data collected changes.

## Purpose
Understand which pages are used and where visitors come from, so the site can be improved and capacity planned.

## Necessity
Aggregate page counts are enough. We do not need to know who a visitor is, so we do not collect identifiers, and no cookie is used for measurement.

## What is processed
- Per day: page path (no query string), referrer domain, device class (desktop/mobile/tablet), view count.
- Per day: unique-visitor count, derived from `HMAC-SHA256(secret, day|IP|user agent)`. These hashes are kept only for the current day and deleted on the first request after the day rolls over. Raw IPs and user agents are never stored.
- Admin pages, API and auth paths, bots, and Do Not Track / Global Privacy Control / opted-out visitors are not counted.
- Per-IP rate limiting holds IPs in memory only (60 requests/minute window), never on disk.

## Balancing test
- Visitors' reasonable expectation: basic traffic counting on a hobby stats site is expected and low-impact.
- Impact: no profiling, no cross-site or cross-day tracking, no sharing, no linking to Steam/Discord accounts.
- Safeguards: aggregate-only storage, 395-day retention, admin-only access, free opt-out (DNT, GPC, or the `/privacy` toggle) that is easy to find in both site footers.
- Conclusion: the interest in measuring site use is not overridden by visitors' rights. Lawful basis: legitimate interest (UK/EU GDPR Art. 6(1)(f)).

## Cookies and storage (PECR / ePrivacy)
No cookie or storage is used for measurement. The only item set is the `dlns_optout` preference cookie (and an equivalent localStorage flag), created only when a visitor chooses to opt out, solely to honour that choice. It holds no identifier.

## Rights and contact
Because no data identifies an individual, access/erasure requests cannot be matched to a person; aggregate counts are not personal data. Visitors can contact the site operator with questions.

## Rules to keep this valid
- Never join analytics data with user accounts, Steam or Discord IDs.
- Never store raw IPs, user agents or full URLs with query strings.
- Do not share or sell the data.
- Set `TRUSTED_PROXIES` correctly behind a proxy so IPs are accurate and unspoofable.
- Re-run this assessment if any of the above changes.
