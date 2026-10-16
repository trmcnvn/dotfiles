# Services and modules

## Roles

Classify code by what would make it change:

- Business meaning, invariant, calculation, or state transition: **Domain Module**. Pure: no I/O, ambient time, randomness, or globals. Owns its type, parsers, smart constructors, transitions, and test arbitraries.
- Application policy, authorization, or effect sequence: **Application Service**. Owns which effects happen, in what order, under what policy.
- Protocol, framework, database, runtime, or vendor API: **Adapter**. Owns translation, failure classification, and safe diagnostics.
- Construction and wiring: **composition root**.

```txt
external input -> inbound Adapter -> Application Service -> Domain Module
                                            +-> capability service -> outbound Adapter -> external system
```

A single vendor client may stay private inside the service that uses it. Extract an Adapter when it hides meaningful translation, is reused, or supports real implementation variation. Inbound Adapters verify credentials into a parsed `Principal`; Domain Modules decide permissions; services enforce them.

## Service or value

A service owns a real capability: authority over persistence, credentials, I/O, resources, configuration, time, or randomness; reusable effect sequencing; or real production/test variation. Prefer built-in services (`Clock`, `Random`, `Config`, `HttpClient`, `FileSystem`) first.

Keep parsed inputs, pure calculations, per-call options, and forwarding wrappers as values or plain functions.

Name the capability with stable domain vocabulary (`UserStore`, `EmailSender`); put specifics in operation names (`findActiveByEmail`). No consumer-qualified names and no generic `Manager`/`Gateway` suffixes.

## Module shape

```ts
export interface Interface {
  readonly operation: (input: Input) => Effect.Effect<Output, OperationError>
}

export class Service extends Context.Service<Service, Interface>()(
  "@app/Capability",
) {}

export const make = Effect.gen(function* () {
  const dependency = yield* Dependency.Service

  const operation = Effect.fn("Capability.operation")(function* (input: Input) {
    return yield* dependency.operation(input)
  })

  return Service.of({ operation })
})

export const layerWithoutDependencies = Layer.effect(Service, make)

export const layer = layerWithoutDependencies.pipe(
  Layer.provide(Dependency.layer),
)

export * as Capability from "./capability.js"
```

- `Interface`, `Service`, `make`, `layerWithoutDependencies`, and `layer` are the canonical role names; the module namespace identifies the capability. Consumers yield `Capability.Service`.
- `layerWithoutDependencies` keeps requirements visible; `layer` selects production dependencies.
- Only the owning module and tests call `make`. Runtime code imports Layers and yields the service.
- Keep members function-valued, including zero-argument operations.

## Layers and wiring

- `Layer.succeed` for an existing value, `Layer.sync` for lazy sync construction, `Layer.effect` for effectful acquisition, `Layer.unwrap` when config builds the Layer, `Layer.effectContext` when one acquisition supplies several tags.
- Yield stable dependencies while building the Layer and close over them. Yield request-scoped context inside the method that uses it.
- When a Layer depends on a service, yield it inside the Layer's construction Effect; do not export `makeXLayer(service)` factories that take services as arguments.
- `Layer.provide` hides a dependency; `Layer.provideMerge` re-exposes it; `Layer.mergeAll` combines independent Layers. Keep runtime Layers flat, named, and provided at their owning boundary.
- Long-lived fibers, streams, and listeners fork into the Layer scope with `Effect.forkScoped`.

## Named operations

Use `Effect.fn("Capability.operation")` for public and non-trivial service methods; `Effect.fnUntraced` only for internal helpers. Attach whole-operation concerns (error translation, spans, retry, timeout) as transforms after the generator. A transform needing the original arguments receives `(effect, ...args)`:

```ts
const readAttachment = Effect.fn("Attachment.read")(
  function* (ref: AttachmentRef) {
    return yield* client.read(ref)
  },
  (effect, ref) => effect.pipe(Effect.annotateLogs({ attachmentId: ref.id })),
)
```

## Test Layers

Tests cross the same `Service` tag as production. Provide `layerTest` (faithful in-memory) or a real local substitute such as SQLite when persistence or protocol behavior matters. Test controls live on a separate `TestService`; see [`testing.md`](testing.md#test-implementations).
