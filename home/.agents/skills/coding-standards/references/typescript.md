# TypeScript

Use these rules when reading or editing `.ts` or `.tsx`. Match the repository's established discriminants, brand representation, schema library, test framework, and logger before introducing a local convention.

| Rule | Standard |
|---|---|
| Discriminated unions | Model variants with one literal discriminant. Do not use optional-field bags for mutually exclusive states. |
| Branded types | Brand confusable primitives and validate once at creation. |
| Constructive modeling | Choose a representation whose parts are legal instead of repeatedly guarding a loose shape. |
| Simplest total type | Keep the weakest type that leaves every operation total; strengthen only where the loose type forces a lie. |
| `unknown` over `any` | Treat external data as `unknown` and narrow it before use. |
| No unchecked casts | Do not use `as` to suppress a mismatch. Cast only after validating an invariant TypeScript cannot express. |
| Narrowing | Prefer compiler-supported narrowing over user-defined guards and casts. |
| Type guards | Verify the complete claimed type and name guards `isX` or `hasX`. |
| Exhaustiveness | Prove closed variants exhaustive with an inline `never` check. |
| `satisfies` over `as` | Check literals without widening them. |
| Boundary validation | Parse where data crosses into trusted code, then trust the parsed value inside. |
| Schema-derived types | Derive equivalent shapes from canonical contracts before declaring another interface. |
| Object arguments | Use named object arguments when positional values are easy to swap. |
| Real tests | Do not mock what the normal test environment can run. |
| Structured telemetry | Use structured diagnostics with safe debugging context; no `console.log` in shipped code. |

## Discriminated unions

If variants carry different data, give every variant the same literal discriminant field with a unique value.

```ts
// Avoid: contradictory combinations are representable.
type LooseDiffState = {
  readonly loading: boolean;
  readonly diff?: GitDiff;
  readonly error?: string;
};

// Prefer: every value is one valid state.
type DiffState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly diff: GitDiff }
  | { readonly kind: "error"; readonly error: string };
```

Pick one established discriminant name such as `kind`, `type`, or `tag` within a type family.

Handle every closed union exhaustively:

```ts
function renderState(state: DiffState): View {
  switch (state.kind) {
    case "loading":
      return renderSpinner();
    case "ready":
      return renderDiff(state.diff);
    case "error":
      return renderError(state.error);
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
```

For a statement-only switch, assign the value to `never` and then use `void exhaustive`. Never add a default branch that silently absorbs future variants.

## Branded types

Brand primitives when mixing values with the same runtime representation is a realistic defect. Match the repository's convention; otherwise use a phantom `readonly __brand` field.

```ts
type AgentId = string & { readonly __brand: "AgentId" };

function parseAgentId(input: string): AgentId {
  if (!isUuid(input)) {
    throw new Error("Invalid agent id");
  }

  // The runtime check above established the invariant TypeScript cannot express.
  return input as AgentId;
}

function focusAgent(id: AgentId): void {
  // id is trusted here.
}
```

Keep the cast inside the parser or smart constructor. Callers do not brand values directly. Do not brand primitives by reflex when there is no invariant or mix-up risk.

## Constructive modeling

Build a type from legal components rather than subtracting illegal values from a loose representation.

```ts
type NonEmpty<T> = readonly [T, ...T[]];
type Pairs<T> = ReadonlyArray<readonly [T, T]>;

function isNonEmpty<T>(values: readonly T[]): values is NonEmpty<T> {
  return values.length > 0;
}

function first<T>(values: NonEmpty<T>): T {
  return values[0];
}
```

A pair collection is a collection of pairs, not a flat array plus an even-length assertion. Represent a range with a validated start and non-negative duration so ordering is not held in a comment:

```ts
type TimeRange = {
  readonly start: Instant;
  readonly duration: NonNegativeDuration;
};
```

Construct `Instant` and `NonNegativeDuration` through their owning parsers, then derive the end when needed.

## Simplest total type

Do not strengthen every collection. A plain array is correct when empty has a defined result:

```ts
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
```

Strengthen when the loose type forces a non-null assertion, cast, or impossible-case throw:

```ts
// Avoid: partiality is hidden from the caller.
function newestSession(sessions: readonly Session[]): Session {
  return sessions.at(0)!;
}

// Prefer when empty is invalid for this operation.
function newestSession(sessions: NonEmpty<Session>): Session {
  return sessions[0];
}
```

Returning `Session | undefined` is the other total signature. Put the empty-case decision at the caller that knows what empty means.

## `unknown`, parsing, and casts

`any` disables checking everywhere it flows. Values from JSON, RPC, `postMessage`, IPC, files, environment variables, databases, persistence, and third-party clients enter as `unknown`.

Parse boundary input into a fresh trusted value:

```ts
type User = {
  readonly id: string;
};

function parseUser(input: unknown): User {
  if (typeof input !== "object" || input === null) {
    throw new Error("Expected user object");
  }

  if (!("id" in input) || typeof input.id !== "string") {
    throw new Error("Expected user id");
  }

  return { id: input.id };
}
```

Do not write `const user = input as User`. When removing a cast, identify why inference failed:

- missing discriminant: introduce a discriminated union;
- overly wide source: narrow it;
- untyped boundary: add a parser or schema;
- duplicated contract: derive its type;
- inexpressible invariant: contain a validated brand cast in its constructor.

For an already typed union, prefer discriminant narrowing, then `in`, then `typeof` or `instanceof`, then a fully verifying user-defined guard. For `unknown`, first prove the value is non-null and object-like before using `in` or reading a discriminant. A validated cast is the last resort.

```ts
function area(shape: Shape): number {
  if ("radius" in shape) {
    return Math.PI * shape.radius ** 2;
  }

  return shape.width * shape.height;
}
```

A type guard must verify its complete claim:

```ts
function isCircle(shape: Shape): shape is Circle {
  return shape.kind === "circle";
}
```

Prefer direct discriminant narrowing when it is sufficient; a guard adds a layer the reader must follow.

## `satisfies` over `as`

Use `satisfies` to check a literal without widening useful literal types:

```ts
// Avoid: widens the value and suppresses useful inference.
const assertedConfig = { theme: "dark", columns: 3 } as Config;

// Prefer: checks Config while preserving literal types.
const config = { theme: "dark", columns: 3 } satisfies Config;
```

`satisfies` checks typed values; it does not parse external data.

## Boundary validation

Parse once where data crosses into trusted code and pass the parsed value inward. Do not revalidate it deep in the call chain.

- Decode wire formats according to their compatibility policy; when supported and intended, ignore unknown fields for forward compatibility.
- Store persisted JSON in a versioned representation and handle decoding failures at the persistence boundary.
- Treat every serialization, persistence, or process hop as a new boundary.

## Schema-derived types

When a generated schema or canonical contract already defines the same concept, derive the needed projection instead of duplicating it.

```ts
import type { ChecksMessage } from "<generated module>";

function renderChecks(
  summary: Pick<ChecksMessage, "totalCount" | "checks">,
): View {
  // ...
}
```

Consider `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` before declaring another interface. Define a separate domain type when it has different semantics or invariants and translate at the boundary.

## Object arguments

Use an object when positional arguments are easy to swap or the call benefits from named structure:

```ts
openFile({
  uri,
  selection: {
    startLineNumber: 10,
    startColumn: 1,
    endLineNumber: 10,
    endColumn: 1,
  },
});
```

Preserve naturally unambiguous positional APIs. Skip new argument-object allocation on proven hot paths such as per-frame rendering, tokenizers, and parsers.

## Real tests

- Run real framework, database, filesystem, protocol, and UI primitives when practical.
- Replace dependencies through production seams rather than module mocks or method spies.
- Assert caller-visible values, errors, persisted state, emitted records, or rendered output.
- Check cleanup and disposal when the framework supports leak detection.
- Verify integration-dependent UI behavior in a running build.
- Mock only what cannot reasonably run locally.

## Structured telemetry

Use the repository's structured logger rather than `console.log` in shipped code. Include stable operation names, safe identifiers, state, attempt counts, and error tags needed to diagnose the event.

```ts
logger.warn("Job delivery failed", {
  jobId: job.id,
  attempt,
  errorTag: error._tag,
});
```

Never serialize arbitrary payloads, thrown values, environments, secrets, or personal data into diagnostics.

## Completion check

Before completing a TypeScript change, verify that:

- variants cannot form contradictory states and closed unions are exhaustive;
- boundary values enter as `unknown` and leave through a parser;
- brands and strengthened types solve a concrete misuse or partiality;
- no new `any`, non-null assertion, or unchecked cast remains;
- equivalent canonical contracts are derived rather than duplicated;
- argument shape makes confusable calls self-documenting;
- tests exercise behavior through the highest practical real seam;
- shipped diagnostics are structured and safe; and
- the repository's relevant static checks and focused tests pass.
