# Frontend architecture

## Architecture direction

Composition is the foundation: pages combine reusable components, compound controls, and focused hooks. Use shadcn/ui for new shared primitives, and keep feature behavior outside those primitives. The detailed rules are in [AGENTS.md](AGENTS.md).

TanStack Query is the selected library for server-data fetching, caching, and mutations through the existing `src/api/` adapters. Its runtime installation and data-flow migration are pending. Zustand remains responsible for shared client-only journey and UI state in the target architecture. Resource-specific hooks belong to their feature; hooks used across features belong in `src/hooks/`.

The current application still stores some server records in Zustand. Adopt query hooks one flow at a time, preserving both mock and HTTP behavior and removing duplicate server-state ownership for each migrated flow. The layout and data-flow descriptions below document the existing implementation, not a claim that every flow has already migrated.

## Current application layout

InsurShield's web app is a React 19 + Vite single-page PWA. The code is organised **by feature**, with a **service layer (`src/api`)** between the UI and the backend, **pure business rules (`src/domain`)** that know nothing about React or storage, and **one persisted store (`src/store`)** split into slices.

```
apps/web/
├── src/
│   ├── main.jsx               Entry: mounts <App/>, registers the service worker in production
│   ├── index.css              Tailwind v4 theme tokens (colours, fonts) and base styles
│   │                          (the icon font itself is declared in index.html so it loads before the bundle)
│   ├── app/                   Composition root
│   │   ├── App.jsx            Router and route table
│   │   └── guards.jsx         CustomerRoute / StaffRoute
│   ├── config/
│   │   └── env.js             Runtime config from VITE_* variables (frozen object)
│   ├── api/                   Backend access — the only place that knows about endpoints
│   │   ├── contracts.js       JSDoc types for every record + the endpoint map (source of truth shared with the backend)
│   │   ├── http/index.js      Real adapter: axios calls to the REST API
│   │   ├── mock/index.js      Mock adapter: same functions, served from the store (default in dev/demo)
│   │   ├── capture.js         Photo hand-off relay client
│   │   ├── shared.js          Idempotency keys, mock latency
│   │   └── index.js           `api` = http or mock, chosen by VITE_API_MODE
│   ├── domain/                Pure business rules (no React, no storage, fully unit-tested)
│   │   ├── premiumEngine.js   Rate × value × usage, PIA floor, NCD, pro-rating, policy dates
│   │   ├── quoteValidity.js   Quote / request expiry rules
│   │   ├── insurers.js        Insurer catalogue, PIA config, reconciliation
│   │   ├── inspection.js      The seven live inspection shots, photo stamping
│   │   └── rtsa.js            RTSA anniversary rules
│   ├── store/                 Client state (Zustand + persist)
│   │   ├── index.js           Public entry: useStore, selectors, DEMO_CUSTOMER_ACCOUNT
│   │   ├── store.js           Composes the slices with persistence
│   │   ├── slices/session.js  Customer account, staff session, consent, auth token
│   │   ├── slices/journey.js  The quote journey in progress
│   │   ├── slices/catalogue.js Insurers and PIA config (admin-owned)
│   │   ├── slices/records.js  Quote requests, policies, claims, NCD, inspections
│   │   ├── persistence.js     Storage key/version, migrations, merge, partialize
│   │   ├── selectors.js       Derived reads (active insurers, "belongs to customer" …)
│   │   ├── demoSeed.js        Demo account and demo records
│   │   └── shared.js          Small helpers used by the slices
│   ├── features/              One folder per product area
│   │   ├── home/              Landing page
│   │   ├── auth/              Create account / sign in, staff login, consent modal
│   │   ├── quote-journey/     Cover → vehicle → usage → request → compare, live photos, phone hand-off
│   │   ├── payment/           Payment and "payment received" confirmation
│   │   ├── account/           Customer portfolio (policies, requests, claims)
│   │   ├── policies/          Renewal
│   │   ├── claims/            First notification of a claim, NCD applications
│   │   ├── inspections/       Inspection requests
│   │   ├── support/           Insurer directory and FAQs
│   │   ├── insurer-portal/    Insurer dashboard: quote queue, paid policies, claims, NCD
│   │   └── admin/             Super-admin console: insurer CRUD, PIA floor, account lookup
│   ├── components/            Shared UI only: ui/ (Button, Card), layout/ (MainLayout)
│   ├── hooks/                 Reusable hooks (useDocumentUpload)
│   ├── lib/                   Framework-level helpers: apiClient (axios), files, documents, device, time, cn
│   └── test/                  Vitest setup and smoke test
├── tools/capture-relay.js     Dev-server relay for the phone hand-off (documents the production endpoints)
├── tools/build-icon-font.mjs  Rebuilds the self-hosted Material Symbols subset in public/fonts (run after adding an icon)
├── tests/                     Playwright end-to-end specs
├── public/                    PWA manifest, service worker, icons
└── .env.example               Environment variables
```

Each feature folder contains `pages/` (route targets), `components/` (used only by that feature) and any feature-local helpers or tests. Anything used by two features moves up to `components/`, `hooks/`, `lib/` or `domain/`.

## Dependency rules

```
features ──► api ──► lib/apiClient
   │          │
   │          └──► store (mock adapter only)
   ├──► store ──► domain
   ├──► domain
   └──► components / hooks / lib
```

- `domain/` imports nothing from React, the store or the API. It is plain functions and constants and is the easiest code to unit-test.
- `store/` may import `domain/`; it never imports features or the API.
- `api/http` never touches the store except through `apiClient` (to read the auth token). `api/mock` is the one place allowed to call store actions on behalf of "the backend".
- `features/` never call `axios`, `fetch` or `localStorage` directly — they go through `api` and `useStore`.
- `app/` is the only place that knows the route table.

Imports use the `@/` alias for anything outside the current folder (`@/domain/premiumEngine`), and `./` inside a folder.

## Current data flow

1. A page reads state with `useStore` (or a selector such as `useActiveInsurers`) and renders.
2. A user action calls either a **store action** (journey state that lives only on the device: chosen cover, declared value, photos) or an **API function** (`api.payments.pay`, `api.vehicles.lookupPlate`) for anything that is a backend concern.
3. In **mock mode** the API function performs the change on the store and resolves after a short delay. In **http mode** it calls the backend; the calling page then updates the store with the response (`recordPayment(receipt)`), so the rest of the UI is unchanged.

Today the mock adapter is complete and two flows are already routed through `api` (vehicle lookup, payment). Store actions for records (`addInsurerQuote`, `issuePolicyCertificate`, `addClaim`, …) are still called directly by some pages; each one has a matching `api` function ready, so wiring a page to the backend is a local change to that page.

## Connecting the backend

1. Implement the endpoints in `src/api/contracts.js`. Request and response shapes are the JSDoc typedefs in that file; the backend owns them from here on and the frontend follows.
2. Set `VITE_API_MODE=http` and `VITE_API_BASE_URL` in `.env.local` (see `.env.example`). `apiClient` sends JSON, credentials, and `Authorization: Bearer <token>` when `session.authToken` is set (`setAuthToken` after login).
3. Errors must be JSON `{ code, message, details? }` with a proper HTTP status; the client turns them into `ApiError` so pages can show `error.message`.
4. `POST`s that create money or policy records carry an `Idempotency-Key` header — replaying the same key must not create a second record.
5. Documents (quotations, certificates, photos) become multipart uploads returning a `DocumentRecord` with a signed `url`; the pages already handle either `url` or `dataUrl`.
6. For each page still calling a record action directly, introduce a resource-specific query or mutation hook that calls the `api` equivalent. Read server records from the query cache and invalidate or update the relevant queries after a mutation. Keep client-only journey state in Zustand and preserve the mock adapter as the development data source.
7. The insurer-side procedure (quote distribution, certificate return, claim notifications, signed webhooks) is in [`../../docs/INSURER_API_INTEGRATION.md`](../../docs/INSURER_API_INTEGRATION.md).

## Adding a feature

1. Create `src/features/<name>/pages/<Name>Page.jsx` and register the route in `src/app/App.jsx` (wrap in `CustomerRoute` or `StaffRoute` as needed).
2. Put business rules in `src/domain/` with unit tests and backend operations in `src/api/contracts.js` and both adapters. Compose query and mutation hooks around those operations. Put shared client-only state in the relevant store slice, and follow the persistence version and migration mechanism when its stored shape changes.
3. Add a Vitest test for any rule and a Playwright spec in `tests/` for the user-visible flow.

## Insurer workspace

`/insurer` uses `InsurerShell` and the installed shadcn Sidebar components, behind the existing staff route guard. Section links use `?view=guides`, `policies`, `claims`, or `ncd`; the overview uses the base URL. Desktop navigation collapses to icons, while the mobile drawer closes after selection and returns keyboard focus to its trigger.

The overview composes shadcn summary cards and a reusable `DataTable` for incoming and sent quotes. The table uses TanStack Table v9 for sorting and pagination and keeps actions bound to each original request. Each summary card links to the work it counts.

The portal is an exchange desk beside the insurer's own systems: a request arrives, the officer does the work in their own system, and one thing is handed back. Every screen is built from four patterns in `src/features/insurer-portal/components/`, so the officer always finds whose turn it is, how long the customer has waited, and what the customer sees afterwards:

| Pattern | Used for | Parts |
| --- | --- | --- |
| Work queue | Quote requests, paid policies, open NCD applications | `DataTable` with `renderCard`; one action per item; stacked cards on phones. Paid policies and NCD applications list the longest wait first (`waitingLongestFirst`). |
| Task screen | Preparing a quotation (`?quote=<requestId>`), issuing a certificate (`?view=policies&issue=<policyNumber>`) | `TaskScreen`, `TaskPanel`, `TaskOutcome`: the case journey (`CaseProgress`), what the customer gave, what the insurer hands back, then what the customer gets, directly above the one action. |
| Review and decide | NCD decisions | `DecisionDialog`: the facts to check and every outcome with its consequence; an outcome is chosen and then confirmed. |
| Record detail | Claim notifications | Master–detail with `StepTrack`, `FactGroup` and `ContactLinks`; optional facts the customer did not give are left out rather than shown blank. |

Task screens are addressed by the record they act on, so Back and refresh keep the officer's place; finishing one offers the next waiting item in its confirmation, which stays long enough to be reached with a keyboard and is checked against the queue when it is used. A screen change moves focus to the screen's content. Every change is followed by a reload of the portal's records whether or not it succeeded (`thenReloadPortal`), because a request can fail after the server acted on it. `usePortalAction` gives every portal action the same pending state, duplicate-submission guard and failure message; a queue whose rows each carry an action holds `useKeyedPortalAction` itself, keyed by record, so the guard outlives a row that leaves the page. A task screen is mounted with its record as `key`, so nothing typed or uploaded for one record carries into the next. `portal.js` holds the shared rules: the case stages, the reply deadline, the premium check against the indicative estimate, and status tones.

The portal covers what the current API supports. FR-IP-007, FR-IP-004 and FR-NCD-004 also call for declining a request with a reason, asking the customer for more information, assignment, internal notes, claim status updates and a recorded reason on NCD rejection; none has an operation in `src/api/contracts.js` yet, so none is offered in the interface.

The sidebar follows the [documented composition](https://ui.shadcn.com/docs/components/base/sidebar) using the installed Radix `asChild` API. The table follows the [Radix Data Table recipe](https://ui.shadcn.com/docs/components/radix/data-table). Existing red/neutral theme tokens remain the source of color.

## Customer journey layout and interaction

The customer journey uses `JourneyLayout` for its progress, page heading, and content width. Progress is informational and does not provide links that bypass required inputs. The shared progress indicator exposes its actual completion value to assistive technology.

- Cover comparison uses two shadcn cards in one radio group. Customers choose exactly one cover type, Comprehensive or Third Party Only, and commit that choice on Continue.
- Vehicle lookup and manual entry use labelled tabs. Manual fields are grouped into identity, registration, and valuation, with the valuation warning and acknowledgement visible. Vehicle use is a single-choice radio group with the existing seven options.
- Quote requests group contact and cover details, required documents and photos, and the review/declaration section. Validation moves focus to the first required correction. The summary precedes the submit action on phones.
- Customer quote comparison uses equal-weight, independently expandable cards with the same labelled attributes in the same order. Cards form two columns on wider screens and stack on phones. Compact cards keep price, quote status, validity, inspection, terms notices, documents, and Choose actions visible. Benefits and extended conditions expand with the shadcn Collapsible control. There is no comparison table or mandatory shortlist step.
- Payment separates the itemised quote summary from method entry. Confirmation distinguishes receipt of payment from issuance of the insurer's certificate. Account access is the primary next step; reviews are optional.
- Phone capture uses clear loading, error, retry, and completion states. The camera checks, per-photo relay, and automatic completion behavior are unchanged.

These choices follow [WAI multi-page forms](https://www.w3.org/WAI/tutorials/forms/multi-page/), [grouped controls](https://www.w3.org/WAI/tutorials/forms/grouping/), [form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/), and the [GOV.UK question-page pattern](https://design-system.service.gov.uk/patterns/question-pages/). The installed [shadcn radio-group choice cards](https://ui.shadcn.com/docs/components/radix/radio-group#choice-card) provide the single-choice interaction. Relevant requirements are FR-VEH-001–005, FR-QTE-001–008, FR-CMP-001–005, FR-PAY-001–004, and FR-POL-001–002.

The quote-card pattern adapts [Baymard's research on consistent listing attributes](https://baymard.com/research-articles/list-item-design-ecommerce) and [essential product information](https://baymard.com/research-articles/product-listing-information). Two columns is a project layout choice, not a universal research finding. Stacking cards on phones follows [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

The requirements specification is a draft. Its one-to-five insurer selection rule differs from the current all-insurer broadcast, and its valid-quotation purchase rule differs from the prototype's selectable estimates. This UI cleanup preserves those tested business behaviors; resolving them requires a separate product decision. It does not add backend integrations, driver underwriting fields, or new policy types.

## Testing

| Layer | Tool | Where |
| --- | --- | --- |
| Domain rules, store slices, API mock, helpers | Vitest (jsdom) | `src/**/*.test.js` |
| Components, hooks, route guards | Vitest + React Testing Library | Colocated `src/**/*.test.{js,jsx}` and `src/test/` |
| Dev relay | Vitest (node) | `tools/capture-relay.test.js` |
| User journeys (customer, insurer, admin) | Playwright | `tests/*.spec.js` |

`npm run lint && npm test && npm run test:e2e && npm run build` is the definition of green.
