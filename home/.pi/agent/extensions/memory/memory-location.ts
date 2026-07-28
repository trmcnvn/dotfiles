import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MemoryScope } from "./memory-store";

const REPOSITORY_MARKERS = [".jj", ".git"] as const;
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "memory");
const PROJECT_ID_MAX_CHARS = 200;

/** A GitHub-backed memory document and its non-authoritative local cache. */
export type MemoryLocation = {
	readonly scope: MemoryScope;
	readonly repositoryPath: string;
	readonly displayPath: string;
	readonly cachePath: string;
	readonly legacyPath: string;
};

/** Resolved memory documents for the global and current-project scopes. */
export type MemoryLocations = {
	readonly repository: string;
	readonly projectRoot: string;
	readonly projectIdentity: string;
	readonly global: MemoryLocation;
	readonly project: MemoryLocation;
};

function canonicalizeExistingPath(filePath: string): string {
	try {
		return realpathSync.native(filePath);
	} catch {
		return path.resolve(filePath);
	}
}

function expandHome(filePath: string): string {
	if (filePath === "~") return os.homedir();
	if (filePath.startsWith(`~${path.sep}`)) return path.join(os.homedir(), filePath.slice(2));
	return filePath;
}

function normalizeCacheDir(cacheDir: string | undefined): string {
	return canonicalizeExistingPath(expandHome(cacheDir?.trim() || DEFAULT_CACHE_DIR));
}

function findProjectRoot(cwd: string): string {
	let current = canonicalizeExistingPath(cwd);

	while (true) {
		if (REPOSITORY_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) return canonicalizeExistingPath(cwd);
		current = parent;
	}
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		return null;
	}
}

async function resolveGitConfigPath(projectRoot: string): Promise<string | null> {
	const gitMarker = path.join(projectRoot, ".git");
	const marker = await readTextIfPresent(gitMarker);
	if (marker === null) {
		return existsSync(path.join(gitMarker, "config")) ? path.join(gitMarker, "config") : null;
	}

	const match = /^gitdir:\s*(.+)$/imu.exec(marker.trim());
	if (!match?.[1]) return null;
	return path.join(path.resolve(projectRoot, match[1].trim()), "config");
}

function originUrlFromGitConfig(config: string): string | null {
	let inOrigin = false;
	for (const line of config.split(/\r?\n/u)) {
		const section = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
		if (section?.[1]) {
			inOrigin = /^remote\s+"origin"$/iu.test(section[1]);
			continue;
		}
		if (!inOrigin) continue;
		const url = /^\s*url\s*=\s*(.+?)\s*$/iu.exec(line);
		if (url?.[1]) return url[1];
	}
	return null;
}

function normalizeRemoteIdentity(remote: string): string | null {
	const trimmed = remote.trim();
	if (!trimmed) return null;

	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u.exec(trimmed);
	if (scp?.[1] && scp[2] && !/^[A-Za-z]:[\\/]/u.test(trimmed)) {
		const remotePath = scp[2].replace(/\/+$/u, "").replace(/\.git$/iu, "");
		return remotePath ? `${scp[1].toLowerCase()}/${remotePath.toLowerCase()}` : null;
	}

	try {
		const url = new URL(trimmed);
		if (!url.hostname) return null;
		const remotePath = url.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
		return remotePath ? `${url.hostname.toLowerCase()}/${remotePath.toLowerCase()}` : null;
	} catch {
		return null;
	}
}

async function projectIdentity(projectRoot: string, override: string | undefined): Promise<string> {
	const explicit = override?.trim();
	if (explicit) {
		if (explicit.length > PROJECT_ID_MAX_CHARS || /[\u0000-\u001f\u007f]/u.test(explicit)) {
			throw new Error("PI_MEMORY_PROJECT_ID must be at most 200 characters and contain no control characters.");
		}
		return `explicit:${explicit}`;
	}

	const configPath = await resolveGitConfigPath(projectRoot);
	if (configPath) {
		const config = await readTextIfPresent(configPath);
		const remote = config ? originUrlFromGitConfig(config) : null;
		const normalized = remote ? normalizeRemoteIdentity(remote) : null;
		if (normalized) return `remote:${normalized}`;
	}

	return `local:${projectRoot}`;
}

function slugForProject(identity: string, projectRoot: string): string {
	const identityName = identity.split("/").at(-1)?.replace(/^.*:/u, "") || path.basename(projectRoot);
	const slug = identityName
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 48);
	return slug || "project";
}

function repositoryHash(repository: string): string {
	return createHash("sha256").update(repository.toLowerCase()).digest("hex").slice(0, 16);
}

function projectHash(identity: string): string {
	return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function location(
	scope: MemoryScope,
	repository: string,
	repositoryPath: string,
	cacheRoot: string,
	legacyPath: string,
): MemoryLocation {
	return {
		scope,
		repositoryPath,
		displayPath: `github:${repository}/${repositoryPath}`,
		cachePath: path.join(cacheRoot, "cache", repositoryHash(repository), repositoryPath),
		legacyPath,
	};
}

/** Resolve stable GitHub paths and local cache paths for a Pi working directory. */
async function resolveLocations(input: {
	repository: string;
	cacheDir?: string;
	cwd: string;
	projectId?: string;
}): Promise<MemoryLocations> {
	const projectRoot = findProjectRoot(input.cwd);
	const identity = await projectIdentity(projectRoot, input.projectId);
	const cacheRoot = normalizeCacheDir(input.cacheDir);
	const projectFileName = `${slugForProject(identity, projectRoot)}-${projectHash(identity)}.md`;
	return {
		repository: input.repository,
		projectRoot,
		projectIdentity: identity,
		global: location(
			"global",
			input.repository,
			"global.md",
			cacheRoot,
			path.join(cacheRoot, "MEMORY.md"),
		),
		project: location(
			"project",
			input.repository,
			path.posix.join("projects", projectFileName),
			cacheRoot,
			path.join(projectRoot, ".agents", "MEMORY.md"),
		),
	};
}

/** Pure and boundary-safe operations for resolving memory document locations. */
export const MemoryLocation = {
	defaultCacheDir: DEFAULT_CACHE_DIR,
	resolve: resolveLocations,
} as const;
