# InsurShield web engineering rules

These instructions apply to `apps/web/` and supplement the [root instructions](../../AGENTS.md).

## Structure and dependencies

- Preserve the React, Vite, and JavaScript stack. TanStack Query is the chosen server-state library; Zustand remains for shared client state. Keep adoption bounded to the requested work.
- Keep customer, insurer, and administrator features in this application unless the user explicitly approves splitting deployments.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for module responsibilities and [DESIGN.md](DESIGN.md) for visual conventions.
- Use feature-based organization under `src/features/<feature>/`. Keep feature-specific pages, components, hooks, and helpers together.
- Keep routing and route guards under `src/app/`, shared presentation components under `src/components/`, and pure business calculations under `src/domain/`.
- Use the existing `@/` alias for imports from `src/`. Do not import API server code or depend on another application's internal directory layout.
- Introduce abstractions when they have a concrete purpose. Do not reproduce every backend architecture layer in UI components.

## Composition is the foundation

- Build pages by composing reusable components and hooks. Composition is the default approach for UI structure and reuse.
- Prefer explicit children, slots, and small components with focused responsibilities over inheritance, duplicated markup, or large components controlled by many boolean props.
- Reuse existing shadcn/ui primitives, components composed from them, and hooks before creating another. Keep business-specific pieces within their feature; promote them to shared folders when their contract serves multiple features.
- Separate behavior from presentation when the same behavior supports different layouts. Keep data fetching and workflow decisions out of reusable visual primitives.
- Make dependencies visible through props and hook inputs. Keep component interfaces small without hiding required behavior in global state.

## Compound components

- Use compound components for related parts of one control, such as dialog trigger/content/actions, tabs/list/trigger/panel, or card header/content/footer.
- Let callers compose the parts they need. Avoid forcing every layout into one configuration object or a collection of flags.
- Use local context when parts must coordinate state; presentational groups do not need a provider merely to qualify as compound components.
- Expose controlled state when callers need ownership. Keep default state and uncontrolled behavior coherent where the primitive supports them.
- Preserve accessible names, keyboard interaction, focus management, and event/ref forwarding when composing primitives or using `asChild`.

## Required component library

- New frontend UI must use shadcn/ui components wherever a matching primitive exists. Do not hand-build equivalent buttons, inputs, dialogs, menus, tabs, or other controls, and do not introduce a competing component library.
- Use installed primitives from `src/components/ui/primitives/`. If a required shadcn/ui component is missing, add it through the configured registry instead of recreating it.
- Build domain-specific UI by composing these primitives with reusable components and hooks. Use semantic HTML for layout and content that does not require a UI control.
- Keep reusable application compositions in `src/components/ui/` and feature-specific compositions within their feature. Reuse `@/lib/cn` and the existing theme tokens.
- Existing custom components remain until their replacement is explicitly in scope. Do not expand their use in new UI when a shadcn/ui equivalent is available, or bulk-replace existing screens as part of unrelated work.

## Reusable hooks

- Extract reusable stateful behavior into focused hooks. Keep feature hooks in `src/features/<feature>/hooks/` and hooks shared across features in `src/hooks/`.
- Name hooks for their purpose, such as `usePolicy`, `useSubmitClaim`, or `useDocumentUpload`. Return the data, status, and actions that callers need.
- Keep pure calculations as plain functions in `src/domain/` or the relevant helper module; they do not need a hook wrapper.
- Give effects complete dependencies and cleanup. Keep hooks unconditional and avoid subscriptions or network work during rendering.
- Keep resource-specific query and mutation hooks near their feature. Do not add generic wrappers that conceal TanStack Query's query keys, status, or cache behavior.

## API boundaries and state

- Use TanStack Query (`@tanstack/react-query`) for server-data fetching, caching, synchronization, and mutations. Query and mutation functions call `src/api/`; transport details stay in the HTTP adapter and simulation stays in the mock adapter.
- Keep a stable QueryClient at the application boundary. Do not recreate it on renders, and give each test its own client.
- Define stable query keys with all inputs that affect the result, including record IDs, filters, pagination, and applicable customer or insurer scope. Do not put credentials in keys.
- Use mutation success to update or invalidate the affected queries. Do not duplicate server records in Zustand or maintain parallel loading/error flags for query-owned state.
- Set freshness, refetch, and retry behavior deliberately for the resource. Do not automatically retry payments or other non-idempotent mutations without an explicit idempotency contract.
- Cancel outstanding protected queries and remove their cached data when identity or tenant changes. Do not persist sensitive query data to browser storage by default.
- Use optimistic updates only when rollback and reconciliation are well-defined. Financial and issuance state must reflect authoritative server outcomes.
- Do not build manual fetching effects or a second cache for work TanStack Query already handles. Camera access, subscriptions, and other non-query effects still belong in focused hooks.
- Preserve the documented request and response contract in `src/api/contracts.js`. Keep mock and HTTP adapters consistent when changing a supported operation.
- Use Zustand for shared client-only journey and UI state, and component state for local interactions. Preserve the existing persistence migration conventions when changing stored client data.
- During migration, the existing mock adapter may keep its backing records in the store. Migrate one flow at a time through the API adapter, preserve both modes, and remove that flow's duplicate server-state ownership.
- Use component state for local interaction state. Do not add global state for values that one component can own or derive.
- Change persisted state deliberately. Follow the existing version and migration mechanism when a schema change would invalidate stored data.
- Keep domain calculations pure and independently testable. For server-controlled decisions, the API must enforce the rule even if the UI previews it.
- Treat route guards as user-experience controls, not a substitute for API authorization. Keep prototype credentials and mock identity behavior confined to the existing development mode.

## Components and user experience

- Follow the required component-library rules and reuse existing styles and design tokens. Keep feature behavior out of shared presentation primitives.
- Handle loading, empty, error, and success states for asynchronous flows. Prevent duplicate submissions and retain recoverable user input after failures.
- Use semantic controls, accessible labels, keyboard interaction, and visible focus states. Respect reduced-motion preferences when adding motion.
- Preserve mobile behavior, particularly photo capture, phone handoff, forms, and quote comparison. Account for permission denial and network failure when changing these flows.
- Keep user-facing errors actionable without exposing secrets or internal implementation details.
- Do not restyle unrelated screens while implementing a behavior change or repository restructure.

## Verification

React Testing Library, Vitest, and Playwright are the frontend testing standard. Use React Testing Library with Vitest for component and hook behavior, and Playwright for browser journeys. Reusable testing utilities will be configured separately; do not introduce a competing testing stack.

Run from the repository root:

```bash
npm run test -w @insurshield/web
npm run lint -w @insurshield/web
npm run build -w @insurshield/web
npm run test:e2e -w @insurshield/web
```

- Use Vitest for domain behavior, adapter contracts, store behavior, and component interactions. Assert observable outcomes rather than private implementation details.
- Test compound components through caller composition, keyboard interaction, and controlled state. Test hooks through their observable behavior, including cleanup where relevant.
- For query-driven flows, test loading, success, failure, cache invalidation after mutations, and identity changes where applicable. Isolate QueryClient instances between tests.
- Use Playwright for affected browser journeys. The existing Playwright configuration starts its own server in mock mode; tests of that mode do not prove live integrations work.
- For visible UI changes, inspect the affected desktop and mobile views in addition to automated checks. A folder move with unchanged UI does not require a redesign review.
- If adding a Material Symbols icon, regenerate the existing font subset with `tools/build-icon-font.mjs` and run the icon-font test.
- Keep app-specific development tooling under `tools/` and browser tests under `tests/`. Do not commit generated reports or dependency directories.
