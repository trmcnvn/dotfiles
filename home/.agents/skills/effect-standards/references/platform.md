# Platform boundaries

## HTTP clients

Use `HttpClient` from `effect/unstable/http` for outgoing HTTP. Each boundary operation is one named Effect in an Adapter that builds the request, attaches auth, executes with interruption, classifies status before decoding, decodes into domain types, and translates transport, status, and decode failures into typed errors.

- `HttpClientRequest.prependUrl`, `bearerToken`, `acceptJson`, and `schemaBodyJson` build requests; `HttpClient.mapRequest` configures shared transforms.
- Use `HttpClient.filterStatusOk` before `HttpClientResponse.schemaBodyJson` (or `schemaJson` when status and headers matter).
- `HttpClient.retryTransient` covers transport errors and 408/429/5xx; use operation-level `Effect.retry` for domain-specific errors. `HttpClient.withRateLimiter` paces proactively from `Retry-After` headers.
- Raw `fetch` is allowed only where unstable Effect HTTP cannot be a dependency: wrap it in `Effect.tryPromise`, pass the provided `AbortSignal`, classify status first, and decode with Schema.

## Configuration

Read configuration once at the composition root through typed `Config` recipes.

- `Config.redacted` for credentials, `Config.schema` for refined values, `Config.option` for semantic absence.
- `Config.withDefault` covers missing values only; malformed values still fail. `Config.orElse` catches every parse failure.
- `ConfigProvider.layer` replaces the provider; `ConfigProvider.layerAdd` adds fallbacks; `ConfigProvider.constantCase` and `ConfigProvider.nested` map key shapes.
- Expose `layerConfig(config: Config.Wrap<Options>)` only when callers compose `Config` recipes; keep `layer(options)` for decoded options.

Module imports are inert: only entrypoints start servers, open connections, read env, or register handlers. Each resource has one owner and is released on success, failure, and interruption. Time and randomness come from `Clock` and `Random`; pure functions take concrete values.

## Secrets and observability

- Wrap secrets in `Redacted` at the boundary and unwrap only in the module performing the final I/O.
- Treat personal data as private by default; log only allowlisted fields.
- Annotate diagnostics with operation names, safe IDs, provider names, error tags, and retry counts via `Effect.annotateLogs` and `Effect.fn` spans. Preserve trace context across every changed boundary.
- Check framework instrumentation too: HTTP spans can capture URLs, headers, and bodies before your code runs. Redact at the owner that emits the event and test it with sensitive input.

## Persistence

- Define persistence around a cohesive domain capability; tables, queries, rows, and ORM mechanics stay private to that module.
- Stored rows and cache hits are untrusted input; decode them on every read.
- Select the codec from storage version or discriminator evidence before decoding. Once a representation is selected, malformed data fails there instead of falling through to a looser schema. Migrations commit only after all validation succeeds.

## Transactions, workflows, and idempotency

- Use a database transaction for atomic changes within one datastore, and close it before network calls or long-running work.
- Use a durable workflow when progress must survive process loss or redelivery, or needs delays, compensation, timers, or multiple transaction boundaries.
- Every real duplicate-execution path (retries, redelivery, resumption, concurrent submission) needs an explicit idempotency strategy at the layer that owns duplication: idempotency key, unique constraint, deduplication record, state-transition guard, or transactional outbox/inbox.
- A timeout or lost response does not prove a remote mutation failed. Persist identity and recovery intent before the mutation when undo may be needed, and define the point of no return.
