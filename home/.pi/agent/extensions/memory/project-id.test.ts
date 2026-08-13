import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeRemoteIdentity, resolveProjectContext } from "./project-id";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
	tempDirs.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("resolveProjectContext", () => {
	test("uses the normalized origin remote across machines", async () => {
		const root = await tempDir("agent-memory-project-");
		const nested = path.join(root, "src", "feature");
		await mkdir(nested, { recursive: true });
		await mkdir(path.join(root, ".git"));
		await writeFile(path.join(root, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:Example/Widgets.git\n');

		await expect(resolveProjectContext({ cwd: nested })).resolves.toEqual({
			root,
			id: "remote:github.com/example/widgets",
		});
	});

	test("uses an explicit override", async () => {
		const root = await tempDir("agent-memory-project-");
		await mkdir(path.join(root, ".jj"));

		await expect(resolveProjectContext({ cwd: root, override: "work/widgets" })).resolves.toEqual({
			root,
			id: "explicit:work/widgets",
		});
	});

	test("falls back to the canonical local root", async () => {
		const root = await tempDir("agent-memory-project-");
		await mkdir(path.join(root, ".jj"));

		await expect(resolveProjectContext({ cwd: root })).resolves.toEqual({ root, id: `local:${root}` });
	});
});

describe("normalizeRemoteIdentity", () => {
	test("normalizes SSH and HTTPS remotes", () => {
		expect(normalizeRemoteIdentity("git@github.com:Owner/Repo.git")).toBe("github.com/owner/repo");
		expect(normalizeRemoteIdentity("https://GitHub.com/Owner/Repo.git")).toBe("github.com/owner/repo");
	});
});
