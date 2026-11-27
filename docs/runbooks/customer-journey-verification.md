# Customer journey verification — Batch 20

Scope: US-CUS-001 / FR-CUS-001; local web UX and route-boundary evidence. This is not a production release approval or proof of live provider, authorization, or tenant-isolation behavior.

## Entry-point audit

| Journey | Destination | Required information and outcome |
| --- | --- | --- |
| New quote | `/insurance-type` | Vehicle registration, value and use; compare guides, select insurers and request final quotes. Public preparation; submission requires identity. |
| Recover request | `/account?section=quotes` | Sign in with the original account; find saved requests and their next step. |
| Renewal | `/renewal` | Select an existing policy; vehicle/cover details carry into a fresh comparison. |
| Claim | `/claims?action=claim` | Policy, vehicle, incident and supporting evidence; first-notification reference, then insurer follow-up. |
| NCD | `/claims?action=ncd` | Policy and claim-free history; reference and insurer decision, not guaranteed approval. |
| Inspection | `/inspections` | Vehicle, date, location and contact; appointment, evidence and report. Request form retains a separate introduction. |
| Contact | `/support` | Choose an insurer; have a policy/claim reference if available; call or email directly. Public. |

Inspected Home hero/footer CTAs, shell navigation, account shortcuts/portfolio/quote activity, support cross-links, sign-in return destinations, and `App.jsx` route definitions. Existing account claim/NCD shortcuts already use action-specific URLs. Home lacked direct entry points for several supported journeys; a compact labelled navigation section now exposes all seven without changing the hero or brand. Support's claim/NCD actions previously both opened the generic claims list; regression coverage requires their matching introductions.

## Grounded fixes

- Restrict the development capture-query exception to nonproduction **mock** quote continuation routes with a nonempty code. It cannot unlock account, claims, renewal, inspection, notifications or service-request routes, or any HTTP-adapter route. Eight regression assertions reproduced the earlier bypass before the fix. The mock exception is not production token validation.
- Provide a keyboard skip link, Escape dismissal/focus restoration for the mobile menu, and a semantic sign-in heading visible on small screens.
- Chromium reproduced horizontal overflow at 320px in the claim policy fieldset and plate-verification row. Allow the fieldset/button to shrink/wrap and stack the plate row on small screens.
- Associate claim/NCD labels with their controls; make the police-report checkbox operable by Space instead of a read-only checkbox inside a click-only wrapper.
- Add concise missing preparation/outcome copy; preserve the existing shadcn components and red/neutral visual system.
- Exclude generated Playwright reports/traces from ESLint; no source lint rules disabled.

## Reproducible commands

From the repository root, after the existing dependency setup:

```sh
npm run test:e2e -w @insurshield/web -- --config=playwright.customer-journeys.config.js
npm run test:e2e -w @insurshield/web -- --config=playwright.customer-journeys.config.js --project=chromium
npm run test -w @insurshield/web -- src/app/guards.test.jsx src/app/guards.http.test.jsx src/features/quote-journey/pages/InsuranceTypePage.test.jsx src/features/claims/pages/ClaimsPage.test.jsx src/features/claims/pages/NcdApplication.test.jsx src/features/account/pages/CustomerAccountPage.test.jsx src/features/policies/pages/RenewalPage.test.jsx src/features/support/pages/SupportPage.test.jsx
npm run lint -w @insurshield/web
npm run build -w @insurshield/web
```

The dedicated config starts its own mock-mode server and refuses to reuse an
unknown server. Use its default one worker on shared machines. The CI job runs
the dedicated three-engine suite and retains failure artifacts. On macOS WebKit
the keyboard test uses Option-Tab for links. Chromium and Firefox use Tab.
[Apple’s Safari keyboard guidance](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)

## Evidence and limits

Local runs on 26 November 2026 covered 32 checks per engine. Chromium
153.0.8010.12 and Firefox 155.0 each passed all 32. WebKit 26.6 passed 30 in
the matrix, then passed the two desktop cases whose initial clicks timed out
when rerun in isolation. The full web unit suite passed 798 tests. Web lint
and the build passed with the existing bundle-size warning.

Inspected generated Chromium claim (320px) and cover-selection (1280px) screenshots. A separate Chromium Home measurement found exactly seven journey links and no page overflow at 320px or 1280px.

Tests cover 320px and 1280px entry links, introductory copy, page overflow,
protected routes, destination preservation, capture-query rejection, keyboard
interaction, field labels and reduced motion. The network test blocks media
and fonts and delays document requests in mock mode.

### Local mobile performance baseline

Measured the compiled mock-mode app in Chromium at 390 × 844 with a fresh
cache on each load. The simulation used 150 ms added network latency,
800 kbps download, 400 kbps upload, and 4× CPU slowdown. The main heading
or quote action appeared in all four samples per page. [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditionsByRule)

| Page | Baseline p75, compiled demo | Follow-up p75, compiled HTTP release with Brotli |
| --- | ---: | ---: |
| Home | 6.37 seconds | 2.64 seconds |
| Cover choice | 6.32 seconds | 2.87 seconds |
| Contact the insurer | 6.79 seconds | 2.67 seconds |

The 27 November follow-up used the same device, network and CPU simulation
with an anonymous API response from the local browser fixture. The release
loads only the matching public page, then downloads later journeys and
optional client code as needed. Its browser regression checks cap initial
JavaScript at 210 KiB measured with gzip and verify that Brotli assets are
served with the expected headers.

The local follow-up was faster and remains above the 2.5-second target.
A repeat while the shared host ran other test jobs varied from 3.14 to
4.33 seconds across the three pages. Measure the deployed artifact on
the approved device and network profile before acceptance.
[Frontend deployment](../DEPLOYMENT.md#frontend)

Release validation still needs the approved mobile network profile, real
devices including iOS and Android, manual accessibility checks including
assistive technology and contrast, real API network failures, and client UAT.
