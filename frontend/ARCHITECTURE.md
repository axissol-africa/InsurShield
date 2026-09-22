# Frontend architecture

InsurShield's web app is a React 19 + Vite single-page PWA. The code is organised **by feature**, with a **service layer (`src/api`)** between the UI and the backend, **pure business rules (`src/domain`)** that know nothing about React or storage, and **one persisted store (`src/store`)** split into slices.

```
frontend/
├── src/
│   ├── main.jsx               Entry: mounts <App/>, registers the service worker in production
│   ├── index.css              Tailwind v4 theme tokens (colours, fonts) and base styles
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

## Data flow

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
6. For each page still calling a record action directly, replace the call with the `api` equivalent and hydrate the store from the response. The mock adapter keeps working, so this can be done one feature at a time with both modes green.
7. The insurer-side procedure (quote distribution, certificate return, claim notifications, signed webhooks) is in [`../docs/INSURER_API_INTEGRATION.md`](../docs/INSURER_API_INTEGRATION.md).

## Adding a feature

1. Create `src/features/<name>/pages/<Name>Page.jsx` and register the route in `src/app/App.jsx` (wrap in `CustomerRoute` or `StaffRoute` as needed).
2. Put business rules in `src/domain/` with unit tests; put backend calls in `src/api/contracts.js` + both adapters; put new client state in the relevant store slice (bump `STORAGE_VERSION` and add a migration if the persisted shape changes).
3. Add a Vitest test for any rule and a Playwright spec in `tests/` for the user-visible flow.

## Testing

| Layer | Tool | Where |
| --- | --- | --- |
| Domain rules, store slices, API mock, helpers | Vitest (jsdom) | `src/**/*.test.js` |
| Route guards, smoke render | Vitest + Testing Library | `src/app/guards.test.jsx`, `src/test/` |
| Dev relay | Vitest (node) | `tools/capture-relay.test.js` |
| User journeys (customer, insurer, admin) | Playwright | `tests/*.spec.js` |

`npm run lint && npm test && npm run test:e2e && npm run build` is the definition of green.
