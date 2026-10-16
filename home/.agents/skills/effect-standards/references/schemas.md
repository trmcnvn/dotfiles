# Schemas and parsing

## Provenance

Choose validation from where the value came from:

| Input | Handling |
| --- | --- |
| Unknown external or persisted input: raw bodies, SQL rows, native storage, untyped callbacks | Decode from `unknown` with the boundary schema into the strongest meaningful type. SQL generics and declarations are not runtime evidence. |
| Known encoded representation whose type matches the codec's `Encoded` | `Schema.decodeEffect`, which keeps the input type and still validates contents. Never cast to make a decoder fit. |
| Established domain value | Pass it unchanged. No re-parse, no encode/decode round trip. |
| Newly computed or patched value with new constraints | Establish the invariant with the owning constructor or a typed `Schema.decodeTo` composition. |

Parse once, at the nearest Adapter. Inner code receives parsed domain types, never request payloads, rows, env strings, or vendor records. Re-parse wherever less-trusted data re-enters: database reads, cache hits, RPC responses, events, and workflow replay. `typeof` checks and generic record guards are not parsing.

## Decoders and parsers

- `Schema.decodeUnknownEffect(codec)` for genuinely unknown input; keep it private to the Adapter.
- `Schema.decodeEffect(codec)` for a known encoded type.
- `Schema.fromJsonString(codec)` for a JSON string boundary.
- Sync decoders only in scripts, tests, or startup where throwing is acceptable.

Instantiate a codec once, privately, beside its owner. Export a unary, domain-named parser with the real input type rather than the decoder factory, which leaks `ParseOptions`:

```ts
const DeploymentStage = Schema.String.check(
  Schema.isPattern(/^(local|preview|production)$/),
).pipe(Schema.brand("DeploymentStage"))

const decodeDeploymentStage = Schema.decodeEffect(DeploymentStage)

/** Parses a deployment stage string. */
export const parseDeploymentStage = (
  input: string,
): Effect.Effect<typeof DeploymentStage.Type, Schema.SchemaError> =>
  decodeDeploymentStage(input)
```

Name parsers `parseX`, smart constructors `makeX`, predicates `isX`. Use `schema.makeEffect(...)` when construction failure belongs in the Effect channel.

## Records

```ts
export const User = Schema.Struct({
  id: UserId,
  name: Schema.NonEmptyString,
  email: Schema.OptionFromOptionalKey(EmailAddress),
})

export interface User extends Schema.Schema.Type<typeof User> {}
```

- Reuse related fields with `.fields`, `Schema.fieldsAssign`, and `.mapFields`; use `Schema.encodeKeys` when only key names differ.
- Use a separate boundary schema (`CreateUserRequest`, `UserRecord`) when encoding, naming, or optionality differ from the application type; keep it private to its boundary.
- Add `.annotate({ identifier })` only when tooling consumes it (HTTP API, OpenAPI, codegen).
- Retain runtime refinements for cross-field and computed invariants; `satisfies` is not runtime evidence.

## Optionality

Decoded types use `Option`. Pick the constructor matching the encoded contract:

- `Schema.OptionFromOptionalKey(s)`: absent key.
- `Schema.OptionFromNullOr(s)`: explicit `null`.
- `Schema.OptionFromUndefinedOr(s)` / `Schema.OptionFromOptional(s)`: explicit `undefined`.
- `Schema.OptionFromNullishOr(s)` / `Schema.OptionFromOptionalNullOr(s)`: mixed nullish encodings.

Defaulted values stay required and get their default during decoding.

## Brands and variants

- Scalar IDs and value objects are constrained schemas piped through `Schema.brand(...)`.
- `Data.TaggedEnum` for internal control-flow algebras with `$match`.
- `Schema.TaggedStruct` / `Schema.TaggedUnion` when the union is decoded, encoded, persisted, or sent over the wire.
- `Schema.tag(...)` with `Schema.toTaggedUnion("type")` for external discriminators other than `_tag`.
- At external protocols, give unknown variants an explicit tested fallback; keep internal unions closed and exhaustive.

## Schema tests

Do not write tests that restate a schema's declared constraints. Test transformations, normalization, custom filters, compatibility contracts, round trips, and previously regressed edge cases, through the boundary's public interface when failures are caller-visible.
