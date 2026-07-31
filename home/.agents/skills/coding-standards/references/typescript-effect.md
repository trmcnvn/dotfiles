# TypeScript with Effect

Read [`typescript.md`](typescript.md) first. This reference is an Effect-specific overlay for TypeScript code that imports or provides the `effect` package.

These defaults target Effect v4. Inspect the project's pinned package version and source before selecting an API; prefer pinned or vendored examples over remembered APIs. Preserve established project patterns when they are compatible.

| Concern | Standard |
|---|---|
| Workflows | Compose effects with `Effect.gen` and established `Effect.fn` operation boundaries. |
| Errors | Put expected failures in the typed error channel; preserve defects and interruption. |
| Data | Use Effect Schema for decoded, encoded, persisted, or branded values. |
| Services | Define a service only for a cohesive capability with real ownership or implementation variation. |
| Layers | Acquire stable dependencies once, expose requirements until their owner selects an implementation, and scope resources. |
| Configuration | Decode runtime configuration with `Config` at the composition root; redact credentials. |
| Concurrency | Use scoped fibers and bounded structured concurrency; never leave work floating. |
| Retry | Retry typed failures at the narrowest idempotent boundary with an explicit `Schedule`. |
| Caching | Prefer `Cache`, `ScopedCache`, and request resolvers over handwritten cache machinery. |
| Streams | Use `Stream` for many-valued, ordered, backpressured sources and own long-lived consumers in a scope. |
| HTTP | Keep request construction, status classification, decoding, retry, and error translation in one boundary. |
| Testing | Use Effect-aware tests, Layers, explicit synchronization, and `TestClock`. |

## Workflows and operation boundaries

Use native Effect composition rather than converting to promises inside application code.

```ts
const findUser = Effect.fn("UserService.findUser")(function* (id: UserId) {
  const users = yield* UserStore.Service;
  return yield* users.findById(id);
});
```

Use `Effect.fn("Capability.operation")` for public and non-trivial operations so stack traces, spans, and diagnostics retain an operation name. Keep the generator focused on the workflow; apply retry, timeout, cleanup, annotations, or error translation to the complete effect.

Wrap unavoidable platform or Promise APIs at their owning boundary with `Effect.try`, `Effect.tryPromise`, or the pinned equivalent. Translate rejection before it crosses the boundary and pass the supplied abort signal when the platform supports cancellation.

## Expected errors, defects, and interruption

Expected domain, parsing, configuration, persistence, and integration failures stay in the typed error channel. Model distinct recovery or observability needs as distinct tagged errors.

```ts
export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
  "UserNotFound",
  { userId: UserId },
) {}
```

Recover at the narrowest boundary that can produce a truthful fallback or external outcome. Prefer tag- or predicate-based recovery such as `Effect.catchTag`, `Effect.catchIf`, or their pinned equivalents.

Do not catch all causes in ordinary application code. Defects indicate violated internal invariants; interruption represents cancellation. Preserve both until an explicit supervision or process boundary owns their policy.

## Schema and data

Use Effect Schema when values cross a serialization boundary, require refinement or branding, or need encoded and decoded representations.

```ts
export const User = Schema.Struct({
  id: UserId,
  name: Schema.NonEmptyString,
});

export interface User extends Schema.Schema.Type<typeof User> {}
```

- Decode unknown boundary input with `Schema.decodeUnknownEffect` by default.
- Use synchronous throwing decoders only where throwing is an intentional boundary contract, such as a script or startup entrypoint.
- Apply constraints before branding.
- Represent encoded optionality precisely; do not collapse absent keys, explicit `undefined`, and `null` unless the contract does.
- Reuse schema fields only when the contracts share the same meaning.
- Use tagged schema unions when variants must decode, encode, persist, or derive external schemas.

Keep wire, provider, and persistence representations at their boundary. Translate them into application or domain values before inner workflows use them.

## Services and Layers

An Effect service is an authority seam: a cohesive capability that owns persistence, credentials, external I/O, runtime resources, configuration, time, randomness, lifecycle, or reusable application policy.

Keep deterministic calculations, parsers, constructors, request values, and one-call options as ordinary values. Do not create a service merely to inject a function in tests or rename another service.

Follow the project's established equivalent of this shape:

```ts
export interface Interface {
  readonly findById: (
    id: UserId,
  ) => Effect.Effect<User, UserNotFound | PersistenceError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@app/UserStore",
) {}

export const make = Effect.gen(function* () {
  const database = yield* Database.Service;

  const findById = Effect.fn("UserStore.findById")(function* (id: UserId) {
    return yield* database.findUserById(id);
  });

  return Service.of({ findById });
});

export const layerWithoutDependencies = Layer.effect(Service, make);
```

Acquire stable implementation dependencies while constructing the Layer and close over them in methods. Read request-, fiber-, or operation-scoped context inside the method that uses it.

Let requirements propagate until the module that truthfully selects an implementation provides them. Use `Layer.provideMerge` only when downstream consumers should retain the provided dependency.

Choose Layer constructors by acquisition semantics: existing value, lazy synchronous construction, effectful acquisition, or scoped resource. Verify exact constructor names against the pinned Effect version.

## Configuration and sensitive values

Read runtime configuration through typed `Config` recipes and install providers at the composition root.

- Use `Config.redacted` for credentials.
- Parse refined values with `Config.schema`, `Config.mapOrFail`, or the pinned equivalent.
- Use optional configuration only for semantic absence.
- Defaults handle missing values, not malformed values.
- Keep environment access and provider precedence at startup.
- Unwrap redacted values only in the final I/O owner that needs the raw credential.

Known configuration failures remain typed until the startup boundary reports a safe failure outcome.

## Resources and concurrency

Every resource and fiber has one lifetime owner.

- Acquire and release resources with scoped Effect primitives or scoped Layers.
- Fork long-lived work into the owning scope with `Effect.forkScoped`, `Effect.forkIn`, or the pinned equivalent.
- Await, join, collect, or explicitly supervise every child fiber.
- Bound fan-out with the concurrency option supported by the selected combinator.
- Propagate interruption to child work and external operations.
- Do not start I/O, listeners, workers, or servers at module import time.

Use detached fibers only when a supervisor explicitly owns lifetime, cancellation, failure reporting, and shutdown.

## Scheduling, retry, and idempotency

Use `Schedule` for retry, repeat, polling, pacing, and backoff.

- `Effect.retry` retries typed failures, not defects or interruption.
- Retry only where repetition is proven safe through idempotency, deduplication, uniqueness, or a guarded transition.
- Bound retries unless an owning worker intentionally runs forever.
- Use exponential or Fibonacci backoff with jitter for shared remote dependencies.
- Preserve the exhausted typed failure unless the owner has a truthful fallback.
- Respect provider retry delays when they exceed local backoff.
- Drive recurring work with `Effect.repeat` plus an explicit schedule.

Do not hold a database transaction open across retry delays, network calls, or long-running work.

## Caching and request batching

Use Effect's cache primitives when their semantics fit:

- `Cache` for keyed memoization, TTL, capacity, and same-key in-flight deduplication;
- `ScopedCache` for cached resources requiring finalization;
- `Effect.cached` or `Effect.cachedWithTTL` for one unkeyed value;
- `RequestResolver` when one backend operation can answer many distinct keys.

Construct a cache once in its owning Layer or scope. Give each cache an intentional capacity, TTL, invalidation policy, and failure-caching policy. Acquire expensive stable clients before defining the lookup so a miss pays only for the provider operation.

Use bounded `Effect.forEach` when the backend only supports per-item operations; do not introduce request batching that cannot reduce backend calls.

## Streams

Use `Stream` for sources that naturally emit many ordered values and need transformation, backpressure, or bounded concurrent consumption. Use `Effect.repeat` when one effect repeats without producing a meaningful stream of values.

- Keep producer queues, pubsubs, and mutable references private behind a stream-facing service interface.
- Use `Queue` when each item has one consumer and `PubSub` when every subscriber receives each item.
- Collect only streams known to terminate.
- Give every buffer an explicit bounded-growth and overflow policy.
- Preserve ordering unless unordered concurrency is intentional.
- Fork long-lived consumers into the owning Layer scope.
- Translate typed stream failures at the boundary; reserve cause-level recovery for supervision.

## HTTP boundaries

Prefer the Effect HTTP client exposed by the pinned package and established by the repository. Keep each outbound operation responsible for the complete protocol interaction:

1. construct the request and authentication;
2. execute with interruption support;
3. classify status before decoding a success body;
4. decode unknown response data with Schema;
5. translate transport, status, and decode failures into typed errors;
6. apply retry or rate-limit policy only when repetition is safe.

Use raw `fetch` only at a platform or library boundary that cannot use the project's Effect HTTP modules. Wrap it with `Effect.tryPromise`, pass the provided abort signal, and translate every rejection and invalid response before returning.

## Testing

Use the repository's Effect-aware test integration.

- Prefer `it.effect` for ordinary Effect tests and the live-runtime form only when real runtime behavior is under test.
- Provide dependencies through the same service tags used by production callers.
- Use faithful in-memory or local implementations when their observable contract is sufficient.
- Use `Deferred`, `Queue`, `Latch`, or `Ref` for explicit synchronization instead of sleeps.
- Drive sleeps, schedules, retries, leases, and timeouts with `TestClock`; start the sleeping fiber before advancing time.
- Assert interruption and finalization when they are observable behavior.
- Keep one-off fakes local; expose reusable test-control services only for real service seams.
- Do not use module mocks when a Layer or real local implementation can exercise the production interface.

## Telemetry

Prefer `Effect.fn` operation names, spans, log annotations, and the repository's Effect logger. Record only safe structured fields such as operation, approved identifiers, provider, state tag, retry count, and typed error tag.

Do not log arbitrary causes, payloads, environments, credentials, or personal data. Preserve active trace context through fibers, services, streams, and external calls.

## Completion check

Before completing Effect TypeScript work, verify that:

- every selected API exists in the pinned Effect version;
- expected failures remain typed while defects and interruption remain distinct;
- schemas parse boundary data into trusted values;
- each service represents a real cohesive capability;
- dependencies, resources, fibers, and long-lived streams have explicit owners;
- retries are bounded and safe to repeat;
- caches and concurrency have explicit bounds;
- HTTP status and unknown bodies are classified before use;
- tests use Layers, explicit synchronization, and deterministic time where applicable;
- telemetry is structured and safe; and
- the checks in [`typescript.md`](typescript.md) also pass.
