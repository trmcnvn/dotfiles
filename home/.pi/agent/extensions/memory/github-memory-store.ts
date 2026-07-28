import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryLocation } from "./memory-location";
import type { MemoryAppendResult, MemoryReplaceResult } from "./memory-store";

const GH_TIMEOUT_MS = 15_000;
const GH_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const GITHUB_API_VERSION = "2022-11-28";
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u;

type MemoryMutationResult = MemoryAppendResult | MemoryReplaceResult;

type RemoteDocument = {
	readonly content: string;
	readonly sha: string | null;
};

/** Result returned by the GitHub CLI process boundary. */
export type GhCommandResult = {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
};

/** Input accepted by the injectable GitHub CLI process boundary. */
export type GhCommandOptions = {
	readonly input?: string;
	readonly signal?: AbortSignal;
};

/** Narrow process capability used by the GitHub memory adapter. */
export type GhCommandRunner = (
	args: readonly string[],
	options?: GhCommandOptions,
) => Promise<GhCommandResult>;

/** A memory read, including whether GitHub or the fallback cache supplied it. */
export type GitHubMemoryRead = {
	readonly content: string;
	readonly source: "github" | "cache";
	readonly warning?: string;
};

/** A successful GitHub mutation plus any non-fatal cache warning. */
export type GitHubMemoryMutationSuccess = {
	readonly type: "success";
	readonly content: string;
	readonly sizeBytes: number;
	readonly warning?: string;
};

/** Result of importing one legacy local memory file. */
export type GitHubMemoryImportResult =
	| { readonly type: "created"; readonly warning?: string }
	| { readonly type: "exists" };

/** Configuration for the GitHub-backed memory adapter. */
export type GitHubMemoryStoreOptions = {
	readonly repository: string;
	readonly run: GhCommandRunner;
};

/** GitHub-backed memory capability used by the extension composition root. */
export type GitHubMemoryStore = {
	readonly repository: string;
	initialize(signal?: AbortSignal): Promise<void>;
	read(location: MemoryLocation, signal?: AbortSignal): Promise<GitHubMemoryRead>;
	mutate(
		location: MemoryLocation,
		commitMessage: string,
		mutation: (content: string) => MemoryMutationResult,
		signal?: AbortSignal,
	): Promise<GitHubMemoryMutationSuccess | Exclude<MemoryMutationResult, { type: "success" }>>;
	importIfMissing(
		location: MemoryLocation,
		content: string,
		signal?: AbortSignal,
	): Promise<GitHubMemoryImportResult>;
};

class GitHubMemoryConfigurationError extends Error {
	readonly _tag = "GitHubMemoryConfigurationError" as const;
}

class GitHubMemoryUnavailableError extends Error {
	readonly _tag = "GitHubMemoryUnavailableError" as const;
}

class GitHubMemoryConflictError extends Error {
	readonly _tag = "GitHubMemoryConflictError" as const;
}

class GitHubMemoryProtocolError extends Error {
	readonly _tag = "GitHubMemoryProtocolError" as const;
}

function safeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown GitHub memory error.";
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(output: string, operation: string): unknown {
	try {
		const parsed: unknown = JSON.parse(output);
		return parsed;
	} catch (cause) {
		throw new GitHubMemoryProtocolError(
			`GitHub returned an invalid response while ${operation}. Update GitHub CLI and retry.`,
			{ cause },
		);
	}
}

function parseRepository(repository: string): { owner: string; name: string; fullName: string } {
	const normalized = repository.trim();
	const match = REPOSITORY_PATTERN.exec(normalized);
	if (!match?.[1] || !match[2]) {
		throw new GitHubMemoryConfigurationError(
			`PI_MEMORY_GITHUB_REPOSITORY must use OWNER/REPOSITORY format. Received ${JSON.stringify(repository)}.`,
		);
	}
	return { owner: match[1], name: match[2], fullName: `${match[1]}/${match[2]}` };
}

function apiHeaders(): string[] {
	return [
		"-H",
		"Accept: application/vnd.github+json",
		"-H",
		`X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
	];
}

function endpointFor(repository: { owner: string; name: string }, repositoryPath?: string): string {
	const root = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
	if (repositoryPath === undefined) return root;
	const encodedPath = repositoryPath.split("/").map(encodeURIComponent).join("/");
	return `${root}/contents/${encodedPath}`;
}

function httpStatus(result: GhCommandResult): number | null {
	const match = /\(HTTP\s+(\d{3})\)/u.exec(result.stderr);
	return match?.[1] ? Number(match[1]) : null;
}

function commandFailure(result: GhCommandResult, operation: string): GitHubMemoryUnavailableError {
	const status = httpStatus(result);
	const statusText = status ? ` GitHub returned HTTP ${status}.` : "";
	return new GitHubMemoryUnavailableError(
		`${operation} failed.${statusText} Check gh auth status, network access, and the configured repository, then retry.`,
	);
}

function parseRemoteDocument(output: string): RemoteDocument {
	const parsed = parseJson(output, "reading memory");
	if (
		!isRecord(parsed) ||
		parsed.type !== "file" ||
		parsed.encoding !== "base64" ||
		typeof parsed.content !== "string" ||
		typeof parsed.sha !== "string" ||
		!parsed.sha
	) {
		throw new GitHubMemoryProtocolError(
			"GitHub returned an unexpected memory file response. Verify that the configured path is a regular file.",
		);
	}

	try {
		return {
			content: Buffer.from(parsed.content.replace(/\s+/gu, ""), "base64").toString("utf8"),
			sha: parsed.sha,
		};
	} catch (cause) {
		throw new GitHubMemoryProtocolError(
			"GitHub returned memory content that could not be decoded. Inspect the repository file and retry.",
			{ cause },
		);
	}
}

function parseUpdatedSha(output: string): string {
	const parsed = parseJson(output, "writing memory");
	if (!isRecord(parsed) || !isRecord(parsed.content) || typeof parsed.content.sha !== "string") {
		throw new GitHubMemoryProtocolError(
			"GitHub accepted the memory write but returned an unexpected response. Refresh memory before writing again.",
		);
	}
	return parsed.content.sha;
}

async function readCache(cachePath: string): Promise<string | null> {
	try {
		return await readFile(cachePath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

async function writeCache(cachePath: string, content: string): Promise<void> {
	const directory = path.dirname(cachePath);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
		await rename(temporaryPath, cachePath);
		await chmod(cachePath, 0o600);
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}

function cacheWarning(operation: "fallback" | "refresh", error: unknown): string {
	if (operation === "fallback") {
		return `GitHub memory is unavailable, so this read used the local cache. ${safeErrorMessage(error)}`;
	}
	return "GitHub memory is current, but its local cache could not be refreshed. Future offline reads may be stale.";
}

function createGitHubMemoryStore(options: GitHubMemoryStoreOptions): GitHubMemoryStore {
	const repository = parseRepository(options.repository);
	let initialization: Promise<void> | null = null;
	let mutationTail: Promise<void> = Promise.resolve();

	function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
		const result = mutationTail.then(operation);
		mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async function initialize(signal?: AbortSignal): Promise<void> {
		if (initialization) return initialization;
		initialization = (async () => {
			const result = await options.run([...apiHeaders(), endpointFor(repository)], { signal });
			if (result.code !== 0) {
				const status = httpStatus(result);
				if (status === 404) {
					throw new GitHubMemoryConfigurationError(
						`GitHub memory repository ${repository.fullName} was not found. Create it as a private, initialized repository or update PI_MEMORY_GITHUB_REPOSITORY.`,
					);
				}
				throw commandFailure(result, `Checking GitHub memory repository ${repository.fullName}`);
			}

			const parsed = parseJson(result.stdout, "checking the memory repository");
			if (!isRecord(parsed) || typeof parsed.private !== "boolean") {
				throw new GitHubMemoryProtocolError(
					"GitHub returned an unexpected repository response. Update GitHub CLI and retry.",
				);
			}
			if (!parsed.private) {
				throw new GitHubMemoryConfigurationError(
					`GitHub memory repository ${repository.fullName} is public. Make it private before using Pi memory.`,
				);
			}
		})().catch((error: unknown) => {
			initialization = null;
			throw error;
		});
		return initialization;
	}

	async function readRemote(location: MemoryLocation, signal?: AbortSignal): Promise<RemoteDocument> {
		await initialize(signal);
		const result = await options.run(
			[...apiHeaders(), endpointFor(repository, location.repositoryPath)],
			{ signal },
		);
		if (result.code === 0) return parseRemoteDocument(result.stdout);
		if (httpStatus(result) === 404) return { content: "", sha: null };
		throw commandFailure(result, `Reading ${location.displayPath}`);
	}

	async function putRemote(
		location: MemoryLocation,
		content: string,
		sha: string | null,
		commitMessage: string,
		signal?: AbortSignal,
	): Promise<string> {
		const body = JSON.stringify({
			message: commitMessage,
			content: Buffer.from(content, "utf8").toString("base64"),
			...(sha ? { sha } : {}),
		});
		const result = await options.run(
			[...apiHeaders(), "--method", "PUT", endpointFor(repository, location.repositoryPath), "--input", "-"],
			{ input: body, signal },
		);
		if (result.code === 0) return parseUpdatedSha(result.stdout);
		if (httpStatus(result) === 409) {
			throw new GitHubMemoryConflictError(
				`Memory was unchanged because ${location.displayPath} changed concurrently. Read it again and retry the write.`,
			);
		}
		throw commandFailure(result, `Writing ${location.displayPath}`);
	}

	return {
		repository: repository.fullName,
		initialize,

		async read(location, signal) {
			try {
				const remote = await readRemote(location, signal);
				try {
					await writeCache(location.cachePath, remote.content);
					return { content: remote.content, source: "github" };
				} catch (error) {
					return { content: remote.content, source: "github", warning: cacheWarning("refresh", error) };
				}
			} catch (error) {
				if (isCancellation(error, signal)) throw error;
				if (error instanceof GitHubMemoryConfigurationError) throw error;
				const cached = await readCache(location.cachePath).catch(() => null);
				if (cached === null) throw error;
				return { content: cached, source: "cache", warning: cacheWarning("fallback", error) };
			}
		},

		async mutate(location, commitMessage, mutation, signal) {
			return serializeMutation(async () => {
				const remote = await readRemote(location, signal);
				const result = mutation(remote.content);
				if (result.type === "error") return result;
				await putRemote(location, result.content, remote.sha, commitMessage, signal);
				try {
					await writeCache(location.cachePath, result.content);
					return result;
				} catch (error) {
					return { ...result, warning: cacheWarning("refresh", error) };
				}
			});
		},

		async importIfMissing(location, content, signal) {
			return serializeMutation(async () => {
				const remote = await readRemote(location, signal);
				if (remote.sha !== null) return { type: "exists" };
				await putRemote(location, content, null, `Import ${location.scope} Pi memory`, signal);
				try {
					await writeCache(location.cachePath, content);
					return { type: "created" };
				} catch (error) {
					return { type: "created", warning: cacheWarning("refresh", error) };
				}
			});
		},
	};
}

/** Spawn GitHub CLI with bounded output, optional stdin, timeout, and cancellation. */
export async function runGhCommand(
	args: readonly string[],
	options: GhCommandOptions = {},
): Promise<GhCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("gh", ["api", ...args], { stdio: ["pipe", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let timedOut = false;
		let settled = false;

		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			action();
		};
		const abort = () => child.kill("SIGTERM");
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, GH_TIMEOUT_MS);
		const collect = (chunks: Buffer[], chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (outputBytes > GH_OUTPUT_MAX_BYTES) {
				child.kill("SIGTERM");
				finish(() => reject(new GitHubMemoryProtocolError("GitHub CLI returned too much output.")));
				return;
			}
			chunks.push(chunk);
		};

		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
		child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
		child.on("error", (cause) => {
			finish(() => reject(new GitHubMemoryUnavailableError("GitHub CLI could not be started. Install gh and retry.", { cause })));
		});
		child.on("close", (code) => {
			finish(() => {
				if (options.signal?.aborted) {
					reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Memory operation cancelled."));
					return;
				}
				if (timedOut) {
					reject(new GitHubMemoryUnavailableError("GitHub memory request timed out. Check network access and retry."));
					return;
				}
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					code: code ?? 1,
				});
			});
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(options.input ?? "");
	});
}

/** Construct a private-GitHub-repository memory adapter. */
export const GitHubMemoryStore = {
	create: createGitHubMemoryStore,
} as const;
