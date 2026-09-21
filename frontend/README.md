# InsurShield — customer web app

Prototype front end for InsurShield, a motor-insurance aggregator for Zambia.

## Business model

- **Guests explore freely.** Cover choice, vehicle lookup, declared value and vehicle use need no account.
- **An account is required to act.** Sending a quote request, comparing quotes, paying, renewing and claims all live behind `CustomerRoute`. A guest who reaches one of these steps is asked to sign in or register and is returned to exactly where they were, with their entries preserved.
- **Every insurer gets every request.** A quote request is sent to all active insurers at once (`submitQuoteRequest`). Each insurer replies with its own final quote from the insurer portal (`addInsurerQuote`); until a reply arrives the customer sees an indicative estimate from the published rate. InsurShield is paid per successful policy, so no insurer is favoured.

## Journey

```
/insurance-type → /vehicle-identification → /vehicle-usage
   → [account required] /quote-request → /quotes-comparison → /payment → /confirmation
```

`JourneyProgress` shows the six steps on every page of this flow.

### Live inspection photos and the phone hand-off

Every request carries seven photos taken with the camera at the time of the request (front, rear, left, right, dashboard/mileage, chassis number, car stereo). Photos are stamped with the capture time and plate; gallery images are not accepted.

Customers on a laptop click **Continue on my phone**: a QR code opens `/capture/<code>` on the phone, the photos are taken there and stream back to the laptop. In development this runs through `capture-relay.js`, a small in-memory relay inside the Vite dev server (`server.host: true` exposes it on the LAN; phone and laptop must be on the same network). The relay documents the four endpoints a production API needs to provide.

`getUserMedia` needs a secure context, so over plain `http://<lan-ip>` the phone falls back to its camera app via `<input capture="environment">`; on HTTPS (or localhost) the in-page live viewfinder is used.

### Insurer onboarding and quote responses

Super-admin onboards an insurer with a full company record (legal/trading name, PACRA no., TPIN, PIA licence + expiry, head office, claims-desk contact, first product/rate, default quote validity, inspection rule, NCD acceptance) and an **uploaded logo** (`InsurerOnboardingForm.jsx`; images are resized client-side in `utils/files.js`). The insurer portal is designed as a module beside whatever system an insurer already uses: the insurer prepares the quote in its own system, then records the premium/validity/notes and **uploads the quotation document** (PDF/JPG/PNG ≤ 3 MB) with its internal reference; the customer opens it from the comparison page.

### Quote validity and re-quoting

Each insurer's final quote is an offer with a deadline (`quoteValidityDays` in the catalogue; the insurer can override it per quote and extend an open quote from the portal). The comparison page shows the valid-until date, flags quotes ending within two days, greys out expired ones, and the payment page refuses an expired quote both on open and when Pay is pressed. A request with no valid quotes (or older than 14 days) is marked Expired in the account; **Request new quotes** creates a fresh request pre-filled from the old one, reusing live photos only if they are under 14 days old. Rules live in `src/utils/quoteValidity.js`.

### RTSA anniversary alignment

On the request page a customer can tick **Match my cover to the RTSA registration anniversary** and enter the registration date. Cover then ends on the next quarterly anniversary boundary after the chosen number of quarters (see `calculatePolicyDates`), and the premium is pro-rated by the actual number of days.

## Stack

React 19 · Vite · Tailwind v4 · React Router 7 · Zustand (persisted) · framer-motion.

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN IP for the phone hand-off)
npm run lint
npm run build
npm test         # unit tests (Vitest): premium engine, anniversary dates, insurer reconciliation, store rules, route guards, photo relay
npm run test:e2e # Playwright: full purchase journey, insurer reply, first claim notification (starts its own dev server on :5180)
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/store/useStore.js` | Single persisted store: accounts, journey state, quote requests, policies, claims, staff session. |
| `src/utils/premiumEngine.js` | Premium calculation (rate × value × usage factor, PIA minimum, NCD, pro-rating) and formatters. |
| `src/utils/insurerRates.js` | Insurer catalogue and configurable rates. |
| `src/components/ProtectedRoute.jsx` | `CustomerRoute` and `StaffRoute` guards. |
| `src/components/JourneyProgress.jsx` | Step indicator. |
| `src/pages/` | One file per screen. |

## Prototype credentials

| Role | Where | Credentials |
| --- | --- | --- |
| Customer | `/create-account` | `mwiza.banda@insurshield.zm` / `Customer123!` (OTP `1234`) |
| Staff | `/admin-login` | `admin@insurshield.zm` / `admin123` |
| Insurer | `/admin-login` | `insurer@insurshield.zm` / `insurer123` |

Passwords, OTPs and consent records are kept in browser storage for the prototype only. Production must use a server-issued, expiry-bound OTP, a real identity service and server-side records.
