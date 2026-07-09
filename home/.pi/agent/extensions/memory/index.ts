import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	withFileMutationQueue,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MemoryStore, type MemoryPaths, type MemoryScope } from "./memory-store";

const MEMORY_DIR_ENV = "PI_MEMORY_DIR";
const MAX_CONTEXT_CHARS_PER_SCOPE = 6_000;

const MemoryScopeSchema = StringEnum(["global", "project"] as const, {
	description: "Use global for cross-project preferences; use project for facts and decisions specific to this project.",
});

const MemoryReadScopeSchema = StringEnum(["global", "project", "all"] as const, {
	description: "Read global memory, current-project memory, or both.",
});

type Snapshot = {
	key: string;
	content: string;
};

function resolvePaths(ctx: ExtensionContext): MemoryPaths {
	return MemoryStore.resolvePaths(process.env[MEMORY_DIR_ENV], ctx.cwd);
}

function snapshotKey(paths: MemoryPaths, includeProject: boolean): string {
	return `${paths.baseDir}\0${paths.projectRoot}\0${includeProject ? "project" : "global-only"}`;
}

async function createSnapshot(paths: MemoryPaths, includeProject: boolean): Promise<Snapshot> {
	const [global, project] = await Promise.all([
		MemoryStore.read(paths.globalFile),
		includeProject ? MemoryStore.read(paths.projectFile) : Promise.resolve(""),
	]);

	return {
		key: snapshotKey(paths, includeProject),
		content: MemoryStore.buildContext({
			global,
			project,
			globalPath: paths.globalFile,
			projectPath: paths.projectFile,
			projectRoot: paths.projectRoot,
			maxCharsPerScope: MAX_CONTEXT_CHARS_PER_SCOPE,
		}),
	};
}

function scopeFile(paths: MemoryPaths, scope: MemoryScope): string {
	return MemoryStore.fileForScope(paths, scope);
}

function assertTrustedProjectMemory(
	ctx: ExtensionContext,
	scope: MemoryScope | "all",
): void {
	if (scope === "global" || ctx.isProjectTrusted()) return;
	throw new Error(
		"Project memory is unavailable because this project is not trusted. Trust the project, then retry.",
	);
}

function formatReadSection(label: string, filePath: string, content: string): string {
	return [`## ${label} memory`, `Path: ${filePath}`, "", content.trim() || "(empty)"].join("\n");
}

function truncateToolOutput(output: string): string {
	const truncated = truncateHead(output, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	if (!truncated.truncated) return truncated.content;

	return [
		truncated.content,
		"",
		`[Memory output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}. Read one scope at a time for more.]`,
	].join("\n");
}

export default function memoryExtension(pi: ExtensionAPI): void {
	let snapshot: Snapshot | null = null;
	let snapshotDirty = true;

	async function refreshSnapshot(ctx: ExtensionContext): Promise<Snapshot> {
		const next = await createSnapshot(resolvePaths(ctx), ctx.isProjectTrusted());
		snapshot = next;
		snapshotDirty = false;
		return next;
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshSnapshot(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const paths = resolvePaths(ctx);
		const includeProject = ctx.isProjectTrusted();
		if (snapshotDirty || snapshot?.key !== snapshotKey(paths, includeProject)) {
			await refreshSnapshot(ctx);
		}

		if (!snapshot?.content) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${snapshot.content}` };
	});

	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description:
			"Read durable global or current-project memory. Use this when the injected memory is truncated, before correcting or forgetting memory, or when the user asks what is remembered.",
		promptSnippet: "Read durable global or current-project memory",
		promptGuidelines: [
			"Use memory_read before memory_edit so oldText exactly matches the stored memory.",
		],
		parameters: Type.Object({
			scope: MemoryReadScopeSchema,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			assertTrustedProjectMemory(ctx, params.scope);
			const paths = resolvePaths(ctx);
			const scopes: MemoryScope[] = params.scope === "all" ? ["global", "project"] : [params.scope];
			const sections: string[] = [];

			for (const scope of scopes) {
				const filePath = scopeFile(paths, scope);
				const content = await withFileMutationQueue(filePath, () => MemoryStore.read(filePath));
				sections.push(formatReadSection(scope === "global" ? "Global" : "Project", filePath, content));
			}

			return {
				content: [{ type: "text", text: truncateToolOutput(sections.join("\n\n---\n\n")) }],
				details: {
					action: "read" as const,
					scope: params.scope,
					globalFile: paths.globalFile,
					projectFile: paths.projectFile,
				},
			};
		},
	});

	pi.registerTool({
		name: "memory_write",
		label: "Memory Write",
		description:
			"Append concise durable memory. Store only facts, preferences, constraints, or decisions likely to matter in future sessions. Do not store temporary tasks, progress updates, daily logs, secrets, or credentials.",
		promptSnippet: "Append a durable global or project memory",
		promptGuidelines: [
			"Use memory_write immediately when the user explicitly asks you to remember something.",
			"Use memory_write with project scope unless the memory clearly applies across unrelated projects.",
			"Never use memory_write for todos, temporary work state, progress updates, daily logs, secrets, or credentials.",
		],
		parameters: Type.Object({
			scope: MemoryScopeSchema,
			content: Type.String({
				minLength: 1,
				maxLength: 20_000,
				description: "Concise Markdown containing only the durable information to remember.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			assertTrustedProjectMemory(ctx, params.scope);
			const paths = resolvePaths(ctx);
			const filePath = scopeFile(paths, params.scope);
			await withFileMutationQueue(filePath, () => MemoryStore.append(filePath, params.content));
			snapshotDirty = true;

			return {
				content: [
					{
						type: "text",
						text: `Saved durable ${params.scope} memory to ${filePath}. It will be included from the next user turn.`,
					},
				],
				details: { action: "write" as const, scope: params.scope, path: filePath },
			};
		},
	});

	pi.registerTool({
		name: "memory_edit",
		label: "Memory Edit",
		description:
			"Correct or forget durable memory using one exact replacement. Read the memory first. Set newText to an empty string to remove the matched block.",
		promptSnippet: "Correct or forget an exact block of durable memory",
		promptGuidelines: [
			"Use memory_read before memory_edit and copy an exact, uniquely identifying oldText block.",
		],
		parameters: Type.Object({
			scope: MemoryScopeSchema,
			oldText: Type.String({ minLength: 1, description: "Exact existing text to replace." }),
			newText: Type.String({ description: "Replacement text. Use an empty string to forget the matched block." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			assertTrustedProjectMemory(ctx, params.scope);
			const paths = resolvePaths(ctx);
			const filePath = scopeFile(paths, params.scope);
			const result = await withFileMutationQueue(filePath, () =>
				MemoryStore.replace(filePath, params.oldText, params.newText),
			);
			if (result.type === "error") {
				throw new Error(result.message);
			}
			snapshotDirty = true;

			return {
				content: [
					{
						type: "text",
						text: `${params.newText ? "Updated" : "Forgot"} ${params.scope} memory in ${filePath}. The change will be included from the next user turn.`,
					},
				],
				details: { action: "edit" as const, scope: params.scope, path: filePath },
			};
		},
	});

	pi.registerCommand("memory-refresh", {
		description: "Reload global and current-project memory from disk",
		handler: async (_args, ctx) => {
			const refreshed = await refreshSnapshot(ctx);
			ctx.ui.notify(refreshed.content ? "Memory reloaded from disk." : "Memory reloaded; no entries found.", "info");
		},
	});
}
