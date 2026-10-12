# InsurShield API engineering rules

These instructions apply to `apps/api/` and supplement the [root instructions](../../AGENTS.md).

## Architecture and scope

- Keep the API a modular monolith. Organize modules around business capabilities such as quotes, policies, payments, claims, and inspections.
- Use Clean Architecture to control dependencies and DDD concepts to model business rules. Use the terminology in the requirements and the existing domain.
- Apply these rules to new behavior and the module being changed. A folder move, documentation update, or small fix does not require a module rewrite.
- Keep simple modules small. Introduce a layer or abstraction when it protects a business rule, isolates an external dependency, or supports a concrete second implementation.
- Do not introduce microservices, event sourcing, a message broker, a new database, or new dependencies without an explicit task requirement and authorization.

## Dependency direction

For modules with substantial business logic, use this layout:

```text
<capability>/
├── domain/          # Business rules, entities, value objects, state transitions
├── application/     # Use cases and the ports they require
├── infrastructure/  # Prisma repositories and external service adapters
├── presentation/    # HTTP controllers, request DTOs, response mapping
└── <capability>.module.ts
```

- Domain code must not import NestJS, Prisma, HTTP clients, environment configuration, or infrastructure code. Pass time, generated identifiers, and other external inputs explicitly when rules need them.
- Application use cases coordinate domain behavior through ports. Keep Prisma queries, transport DTOs, and external provider SDKs out of use cases.
- Infrastructure implements ports and maps persistence or provider data into the application's types. Prisma models are persistence details, not public domain or API contracts.
- Controllers validate request shape, obtain the authenticated principal, invoke a use case, and map its result to HTTP. Keep business decisions out of controllers.
- Enforce operation authorization in the application boundary as well as route access controls, so internal callers cannot bypass ownership and tenancy checks.
- Use the NestJS module as the composition root. Bind ports to adapters there; keep framework wiring out of domain code.
- Each business module owns its state changes. Other modules use its published application interface instead of writing its tables directly. Existing shared infrastructure can remain shared.

## Patterns and when to use them

### Ports and adapters

- Use ports at external boundaries: insurer systems, RTSA, payment providers, identity verification, storage, and messaging.
- Define each port around an operation the use case needs. Avoid interfaces that merely copy every method of an SDK.
- Keep provider credentials, request formats, retries, and error translation in the adapter. Preserve provider correlation identifiers for diagnosis.

### Repositories

- Introduce repositories where domain use cases need persistence isolation. Define operations in business terms and implement them with Prisma in infrastructure.
- Do not create a generic base repository or one repository per table by default. Simple reporting queries can use a dedicated query adapter.
- Make transaction boundaries explicit. A repository method must not silently commit part of an operation that the use case expects to be atomic.

### Strategies

- Use strategies when supported insurers or products have materially different pricing, eligibility, or inspection behavior.
- Keep a common input and output contract, select the strategy explicitly, and test each supported variant.
- Keep configurable values as data. Do not create a strategy class for every rate or flag, or build a registry for a single implementation.

### State machines

- Define allowed transitions for workflows such as quotes, payments, policies, and claims. Enforce transitions through domain operations rather than assigning statuses throughout services.
- Validate the transition's business preconditions, including payment and issuance evidence where applicable. Reject invalid transitions with a specific error.
- Protect transitions against concurrent updates using an appropriate transaction, conditional update, version check, or database constraint. An in-memory status check alone is insufficient.
- Make duplicate callbacks and retried commands safe. Test forbidden transitions and repeated requests alongside successful paths.

### Domain events and transactional outbox

- Name events after completed business facts, such as `PaymentConfirmed`. Keep their payloads minimal and exclude credentials and unnecessary personal data.
- Use events when separate work needs to react to an outcome. Prefer a direct use-case call when the caller requires an immediate result or shared atomicity.
- When an event or external action must survive a crash, store an outbox entry in the same database transaction as the business change. An in-process event emitter does not provide durable delivery.
- Deliver outbox entries after commit. Use stable event identifiers, idempotent consumers, bounded retries, and visible failure handling. Assume at-least-once delivery, not exactly-once delivery.
- Do not hold a database transaction open during a network call. Model recovery or compensation when a workflow spans external services.

### Selective CQRS

- Separate commands from queries when their responsibilities or data needs diverge, such as policy changes versus operational dashboards.
- Commands enforce business rules and authorization. Queries return purpose-built read models and enforce access and tenant filters.
- Start with the existing database. Separate databases, a command bus, eventual consistency, and event sourcing are not prerequisites for CQRS.

## Domain and data rules

- Preserve exact monetary values and explicit currencies. Use the existing decimal approach at storage and calculation boundaries; avoid floating-point money calculations.
- Parse external data at boundaries and validate business invariants in domain operations. Avoid repeating the same shape validation in every layer.
- Use discriminated unions for alternative states and derive types from authoritative schemas where appropriate. Do not silence type errors with `any`, unchecked casts, or non-null assertions.
- Keep domain failures independent of HTTP status codes. Translate them at the presentation boundary while preserving the established API error contract.
- Preserve authorization, insurer tenancy, idempotency, audit records, and existing public contracts when refactoring.

## Verification and delivery

- Before a behavioral refactor, identify the observable behavior being preserved and add missing regression coverage for the affected flow.
- Test domain rules without a server or database. Test application orchestration through its ports. Verify persistence and provider adapters with integration or contract tests where their behavior matters.
- For workflow changes, include relevant invalid transitions, duplicate delivery, concurrency, and failure recovery cases. Test outcomes rather than private method calls.
- Run targeted tests first, then API lint, TypeScript checks, and the build. Run integration checks when the change touches persistence or external boundaries, and report any unavailable prerequisites.
- Keep changes bounded to the requested capability. Report architectural tradeoffs and verification gaps; do not add speculative layers or patterns to unrelated modules.
