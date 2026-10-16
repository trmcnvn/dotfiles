# Alchemy and Durable Objects

Verify the pinned Alchemy source before choosing a composition shape: Effectful Constructor phases, bindings, Layers, and the relevant runtime class.

## Two-phase constructors

- The outer init Effect runs during planning and again at runtime cold start.
- The returned inner Effect or handlers run only in the deployed runtime.

Provide infrastructure-backed Layers to the outer Effect, yield their services there, and close over them in handlers:

```ts
Effect.gen(function* () {
  const dependency = yield* ApplicationDependency.Service

  return {
    fetch: requestHandler(dependency),
  }
}).pipe(Effect.provide(ApplicationDependency.layer))
```

Never bypass an existing Layer by yielding its `make` from the composition root. When an inner runtime Layer needs an outer-initialized service, bridge the value with `Layer.provide(Layer.succeed(ApplicationDependency.Service, dependency))`.

A Durable Object's outer Effect runs during planning against mock state. Resolve bindings and describe Layers there, but acquire state-backed resources (SQL clients, migrations, storage services) only inside the returned runtime Effect.

## Durable Objects are HTTP services

Treat each Durable Object as an independent HTTP service exposing an Effect HTTP API through `fetch`. This is a logical service boundary, not necessarily a network hop.

- Do not use typed Alchemy RPC.
- Keep bindings, namespaces, stubs, and `Cloudflare.toHttpClient` inside composition roots and client implementations.
- The rest of the application sees only an application-owned client service.

Name the pair `AccountClient` (the service module) and `AccountServer` (the Durable Object):

```ts
// account-client.ts
export interface Interface {
  readonly getAccount: (id: AccountId) => Effect.Effect<Option.Option<Account>, GetAccountError>
}

export class Service extends Context.Service<Service, Interface>()(
  "@app/AccountClient",
) {}

// account-server.ts
export class AccountServer extends Cloudflare.DurableObject<AccountServer>()(
  "AccountServer",
  accountServerImplementation,
) {}
```

The client's `make` yields its Durable Object service directly and closes over the namespace. Do not hand-write a namespace interface or pass a namespace into `make` or a Layer.

## Identity and routes

- Key and address every instance by its canonical branded domain ID (`AccountServer` by `AccountId`), never a display name or caller-provided label.
- Client methods accept domain IDs; namespace lookup stays inside the client.
- Version every route from `/v1`. Schema names carry no version suffix. No unversioned aliases.

## Execution-scoped clients

Namespaces may be resolved during init, but a stub and its generated HTTP client must be built inside the current Worker or Durable Object invocation. Never keep a stub-backed client across invocations; the canonical ID selects the instance but does not extend the caller's Cloudflare I/O context.

When one invocation may call several instances, combine Alchemy's execution memo with an unbounded `Cache` (the invocation bounds its lifetime). The cache keys clients by domain ID and deduplicates concurrent first lookups. Suspend the namespace lookup so planning never touches a runtime-only binding:

```ts
const accountHttpClients = yield* makeExecutionMemo(
  Cache.make<AccountId, AccountHttpClient>({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (id) =>
      Effect.suspend(() =>
        HttpApiClient.makeWith(AccountHttpApi, {
          baseUrl: "http://account.internal",
          httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
        }),
      ),
  }),
)

const accountHttpClient = (id: AccountId) =>
  Effect.flatMap(accountHttpClients, (clients) => Cache.get(clients, id))
```

Keep the resolver private: public operations call it internally. Never expose it on the interface or as a static on the tag. With exactly one target per invocation, memoize the suspended client Effect directly without `Cache`. `Layer.suspend`, `Layer.unwrap`, isolate-scoped Layers, and global caches all have the wrong lifetime.

Verify that planning runs without native storage access and that repeated invocations do not reuse stale clients.
