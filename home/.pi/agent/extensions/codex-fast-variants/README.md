# Codex Fast Variants

Adds selectable `-fast` variants to Pi's built-in `openai-codex` model catalog.

## Behavior

The extension preserves Pi's normal Codex models and OAuth authentication. During model refresh it:

1. reads the latest official Codex version from the npm registry;
2. requests the account-specific Codex model catalog from `chatgpt.com`;
3. detects `priority` service-tier support, including the legacy `fast` metadata;
4. intersects those results with Pi's built-in Codex catalog; and
5. publishes `<model>-fast` variants as a cached dynamic model overlay.

At startup, the extension preloads previously cached variants and the exact saved `-fast` default before registering the provider. It uses Pi's lock-aware settings loader and retries the catalog read briefly if another Pi process is updating the shared files. This keeps the saved default available during Pi's initial model resolution instead of allowing Pi to fall back to its built-in provider default while the dynamic catalog refreshes.

Selecting a Fast variant sends the real upstream model ID with:

```json
{
  "service_tier": "priority"
}
```

It also sends the official Codex routing hint:

```text
x-codex-routing-hint: model=<model>;tier=priority
```

The selected model ID retains its `-fast` suffix in Pi's standard model display. The provider stream wrapper applies the upstream ID, service tier, and routing hint to normal turns, automatic and manual compaction, and branch summaries.

## Codex installation

The extension does **not** install or execute Codex. It makes an unauthenticated metadata request to `registry.npmjs.org/@openai/codex/latest` because the Codex catalog filters models by client version. Pi's OAuth token is sent only to the ChatGPT Codex backend.

## Failure behavior

Previously cached Fast variants remain available when version or catalog discovery fails. On a first-run discovery failure, the normal Codex catalog remains available without Fast variants.

## Development

```bash
npm run check --workspace=pi-codex-fast-variants-extension
```

Reload Pi with `/reload` after changing the extension.
