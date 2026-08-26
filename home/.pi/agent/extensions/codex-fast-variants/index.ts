import type { Api, Model } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import {
	getAgentDir,
	type ExtensionFactory,
	type ProviderModelConfig,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
	/** Read Pi's saved Codex default before provider registration. */
	readonly readSavedDefaultModel: () => Promise<string | undefined>;
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

function mergeFastVariants(
	...variantGroups: readonly (readonly CodexModel[])[]
): readonly CodexModel[] {
	const variantsById = new Map<string, CodexModel>();
	for (const variants of variantGroups) {
		for (const model of variants) variantsById.set(model.id, model);
	}
	return [...variantsById.values()];
}

function buildProviderModelCatalog(
	baseModels: readonly CodexModel[],
	fastVariants: readonly CodexModel[],
): ProviderModelConfig[] {
	return [...baseModels, ...fastVariants].map(toProviderModelConfig);
}

function restoreStartupFastVariants(
	baseModels: readonly CodexModel[],
	storedCatalog: unknown,
	savedDefaultModel: string | undefined,
): readonly CodexModel[] {
	const fastCapableModelIds = new Set<string>();
	const provider = typeof storedCatalog === "object" && storedCatalog !== null && !Array.isArray(storedCatalog)
		? (storedCatalog as { "openai-codex"?: unknown })["openai-codex"]
		: undefined;
	if (typeof provider === "object" && provider !== null && !Array.isArray(provider)) {
		const models = (provider as { models?: unknown }).models;
		if (Array.isArray(models)) {
			for (const model of models) {
				if (typeof model !== "object" || model === null || Array.isArray(model)) continue;
				const id = (model as { id?: unknown }).id;
				if (typeof id !== "string" || !id.endsWith("-fast")) continue;
				fastCapableModelIds.add(id.slice(0, -"-fast".length));
			}
		}
	}
	if (savedDefaultModel?.endsWith("-fast")) {
		fastCapableModelIds.add(savedDefaultModel.slice(0, -"-fast".length));
	}
	return createCodexFastVariantModels(baseModels, fastCapableModelIds);
}

async function readJsonWithRetry(path: string): Promise<unknown> {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch {
			if (attempt < 4) await sleep(10 * (attempt + 1));
		}
	}
	return undefined;
}

async function readStoredCatalog(): Promise<unknown> {
	return readJsonWithRetry(join(getAgentDir(), "models-store.json"));
}

async function readSavedDefaultModel(): Promise<string | undefined> {
	try {
		const settings = SettingsManager.create(process.cwd());
		return settings.getDefaultProvider() === "openai-codex"
			? settings.getDefaultModel()
			: undefined;
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
		const [storedCatalog, savedDefaultModel] = await Promise.all([
			dependencies.readStoredCatalog(),
			dependencies.readSavedDefaultModel(),
		]);
		const storedFastVariants = restoreStartupFastVariants(
			baseModels,
			storedCatalog,
			savedDefaultModel,
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
				// The built-in Codex remote catalog and this extension share Pi's
				// provider cache entry. A concurrent built-in refresh can replace the
				// cached Fast variants with standard models. Preserve variants restored
				// during extension startup so Pi's immediate no-network refresh cannot
				// erase the saved Fast default before initial model selection.
				const fallbackVariants = mergeFastVariants(
					storedFastVariants,
					storedVariants,
				);
				const fallbackCatalog = buildProviderModelCatalog(baseModels, fallbackVariants);
				if (!context.allowNetwork || context.credential?.type !== "oauth") {
					return fallbackCatalog;
				}

				const clientVersionResult = await fetchLatestCodexClientVersion(
					dependencies.fetchCatalog,
					context.signal,
				);
				if (!clientVersionResult.ok) return fallbackCatalog;
				const catalogResult = await fetchCodexFastModelCatalog({
					baseUrl,
					clientVersion: clientVersionResult.value,
					accessToken: createCodexAccessToken(context.credential.access),
					fetch: dependencies.fetchCatalog,
					signal: context.signal,
				});
				if (!catalogResult.ok) return fallbackCatalog;

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
		readSavedDefaultModel,
	})(pi);
}
