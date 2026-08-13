import type { Api, Model } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import {
	getAgentDir,
	type ExtensionFactory,
	type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createCodexAccessToken } from "./codex-access-token.ts";
import {
	type CodexFastCatalogFetch,
	fetchCodexFastModelCatalog,
	fetchLatestCodexClientVersion,
} from "./codex-fast-catalog.ts";
import { createCodexFastStream } from "./codex-fast-stream.ts";
import {
	createCodexFastVariantModels,
	restoreCodexFastVariantModels,
} from "./codex-fast-variants.ts";
type CodexModel = Model<"openai-codex-responses">;

/** Runtime dependencies for Codex Fast Mode discovery. */
export interface CodexFastVariantsDependencies {
	/** Fetch implementation used only for official Codex metadata and the authenticated catalog. */
	readonly fetchCatalog: CodexFastCatalogFetch;
	/** Read Pi's persisted dynamic model catalog before provider registration. */
	readonly readStoredCatalog: () => Promise<unknown>;
}

function isCodexModel(model: Model<Api>): model is CodexModel {
	return model.provider === "openai-codex" && model.api === "openai-codex-responses";
}

function toProviderModelConfig(model: CodexModel): ProviderModelConfig {
	return {
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		thinkingLevelMap: model.thinkingLevelMap,
		input: [...model.input],
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		compat: model.compat,
	};
}

function buildProviderModelCatalog(
	baseModels: readonly CodexModel[],
	fastVariants: readonly CodexModel[],
): ProviderModelConfig[] {
	return [...baseModels, ...fastVariants].map(toProviderModelConfig);
}

function restoreStoredFastVariants(
	baseModels: readonly CodexModel[],
	storedCatalog: unknown,
): readonly CodexModel[] {
	if (typeof storedCatalog !== "object" || storedCatalog === null || Array.isArray(storedCatalog)) {
		return [];
	}
	const provider = (storedCatalog as { "openai-codex"?: unknown })["openai-codex"];
	if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return [];
	const models = (provider as { models?: unknown }).models;
	if (!Array.isArray(models)) return [];

	const fastCapableModelIds = new Set<string>();
	for (const model of models) {
		if (typeof model !== "object" || model === null || Array.isArray(model)) continue;
		const id = (model as { id?: unknown }).id;
		if (typeof id !== "string" || !id.endsWith("-fast")) continue;
		fastCapableModelIds.add(id.slice(0, -"-fast".length));
	}
	return createCodexFastVariantModels(baseModels, fastCapableModelIds);
}

async function readStoredCatalog(): Promise<unknown> {
	try {
		return JSON.parse(await readFile(join(getAgentDir(), "models-store.json"), "utf8"));
	} catch {
		return undefined;
	}
}

/** Create a Pi extension that discovers and routes selectable Codex `-fast` model variants. */
export function createCodexFastVariantsExtension(
	dependencies: CodexFastVariantsDependencies,
): ExtensionFactory {
	return async (pi) => {
		const baseModels = getModels("openai-codex").filter(isCodexModel);
		const baseUrl = baseModels[0]?.baseUrl;
		if (!baseUrl) {
			throw new Error("Codex Fast built-in provider has no base URL");
		}
		const storedFastVariants = restoreStoredFastVariants(
			baseModels,
			await dependencies.readStoredCatalog(),
		);

		pi.registerProvider("openai-codex", {
			api: "openai-codex-responses",
			baseUrl,
			models: buildProviderModelCatalog(baseModels, storedFastVariants),
			streamSimple: createCodexFastStream(baseModels),
			async refreshModels(context) {
				const storedVariants = restoreCodexFastVariantModels(
					baseModels,
					context.stored?.models ?? [],
				);
				const storedCatalog = buildProviderModelCatalog(baseModels, storedVariants);
				if (!context.allowNetwork || context.credential?.type !== "oauth") {
					return storedCatalog;
				}

				const clientVersionResult = await fetchLatestCodexClientVersion(
					dependencies.fetchCatalog,
					context.signal,
				);
				if (!clientVersionResult.ok) return storedCatalog;
				const catalogResult = await fetchCodexFastModelCatalog({
					baseUrl,
					clientVersion: clientVersionResult.value,
					accessToken: createCodexAccessToken(context.credential.access),
					fetch: dependencies.fetchCatalog,
					signal: context.signal,
				});
				if (!catalogResult.ok) return storedCatalog;

				const fastVariants = createCodexFastVariantModels(
					baseModels,
					catalogResult.value.fastCapableModelIds,
				);
				await context.publish({
					persist: { models: fastVariants },
				});
				return buildProviderModelCatalog(baseModels, fastVariants);
			},
		});

	};
}

/** Register Codex Fast Mode variants using Pi's runtime fetch implementation. */
export default async function codexFastVariantsExtension(
	pi: Parameters<ExtensionFactory>[0],
): Promise<void> {
	await createCodexFastVariantsExtension({
		fetchCatalog: globalThis.fetch,
		readStoredCatalog,
	})(pi);
}
