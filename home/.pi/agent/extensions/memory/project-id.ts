import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY_MARKERS = [".jj", ".git"] as const;
const MAX_PROJECT_ID_LENGTH = 240;

export type ProjectContext = {
	readonly root: string;
	readonly id: string;
};

function canonicalPath(filePath: string): string {
	try {
		return realpathSync.native(filePath);
	} catch {
		return path.resolve(filePath);
	}
}

function findProjectRoot(cwd: string): string {
	let current = canonicalPath(cwd);
	while (true) {
		if (REPOSITORY_MARKERS.some((marker) => existsSync(path.join(current, marker)))) return current;
		const parent = path.dirname(current);
		if (parent === current) return canonicalPath(cwd);
		current = parent;
	}
}

async function readText(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

async function gitConfigPath(projectRoot: string): Promise<string | null> {
	const markerPath = path.join(projectRoot, ".git");
	const marker = await readText(markerPath);
	if (marker === null) {
		const configPath = path.join(markerPath, "config");
		return existsSync(configPath) ? configPath : null;
	}

	const match = /^gitdir:\s*(.+)$/imu.exec(marker.trim());
	return match?.[1] ? path.join(path.resolve(projectRoot, match[1].trim()), "config") : null;
}

function originFromGitConfig(config: string): string | null {
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

export function normalizeRemoteIdentity(remote: string): string | null {
	const trimmed = remote.trim();
	if (!trimmed) return null;

	if (trimmed.includes("://")) {
		try {
			const url = new URL(trimmed);
			const remotePath = url.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
			return url.hostname && remotePath
				? `${url.hostname.toLowerCase()}/${remotePath.toLowerCase()}`
				: null;
		} catch {
			return null;
		}
	}

	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u.exec(trimmed);
	if (!scp?.[1] || !scp[2] || /^[A-Za-z]:[\\/]/u.test(trimmed)) return null;
	const remotePath = scp[2].replace(/\/+$/u, "").replace(/\.git$/iu, "");
	return remotePath ? `${scp[1].toLowerCase()}/${remotePath.toLowerCase()}` : null;
}

function validateProjectId(projectId: string): string {
	if (projectId.length > MAX_PROJECT_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(projectId)) {
		throw new Error(`Project memory identity must be at most ${MAX_PROJECT_ID_LENGTH} characters and contain no control characters.`);
	}
	return projectId;
}

export async function resolveProjectContext(input: {
	readonly cwd: string;
	readonly override?: string;
}): Promise<ProjectContext> {
	const root = findProjectRoot(input.cwd);
	const override = input.override?.trim();
	if (override) return { root, id: validateProjectId(`explicit:${override}`) };

	const configPath = await gitConfigPath(root);
	const config = configPath ? await readText(configPath) : null;
	const remote = config ? originFromGitConfig(config) : null;
	const identity = remote ? normalizeRemoteIdentity(remote) : null;
	return {
		root,
		id: validateProjectId(identity ? `remote:${identity}` : `local:${root}`),
	};
}
