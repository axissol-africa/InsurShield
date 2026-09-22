# InsurShield

Zambian motor-insurance marketplace: customers compare final quotes from every approved insurer, pay, and receive the insurer-issued policy certificate; insurers and the InsurShield administrator work from their own portals.

| Folder | Contents |
| --- | --- |
| [`frontend/`](frontend/) | The web app (React 19 + Vite PWA). Start here: [`frontend/README.md`](frontend/README.md), [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md). |
| [`docs/`](docs/) | Integration and flow notes: [insurer system integration](docs/INSURER_API_INTEGRATION.md), [customer entry / identity / consent flow](docs/CUSTOMER_ENTRY_IDENTITY_CONSENT_FLOW.md). |
| [`design/`](design/) | Original design references: the Stitch screen exports (`screens/<screen>/code.html` + `screen.png`) and the original design-system notes. The live design tokens are in `frontend/src/index.css` and `frontend/DESIGN.md`. |

The backend lives in its own repository and implements the contract in `frontend/src/api/contracts.js`.

## Quick start

```bash
cd frontend
npm install
npm run dev
```

Prototype credentials and the full command list are in [`frontend/README.md`](frontend/README.md).
