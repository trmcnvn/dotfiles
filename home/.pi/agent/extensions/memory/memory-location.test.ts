import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryLocation } from "./memory-location";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), prefix));
	tempDirs.push(directory);
	return realpath(directory);
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("MemoryLocation.resolve", () => {
	test("derives a cross-machine project identity from the origin remote", async () => {
		const cacheDir = await createTempDir("pi-memory-cache-");
		const projectRoot = await createTempDir("pi-memory-project-");
		const nested = path.join(projectRoot, "src", "feature");
		await mkdir(nested, { recursive: true });
		await mkdir(path.join(projectRoot, ".git"));
		await writeFile(
			path.join(projectRoot, ".git", "config"),
			'[remote "origin"]\n\turl = git@github.com:Example/Widgets.git\n',
			"utf8",
		);

		const locations = await MemoryLocation.resolve({
			repository: "owner/pi-memory",
			cacheDir,
			cwd: nested,
		});

		expect(locations.projectRoot).toBe(projectRoot);
		expect(locations.projectIdentity).toBe("remote:github.com/example/widgets");
		expect(locations.global.repositoryPath).toBe("global.md");
		expect(locations.project.repositoryPath).toMatch(/^projects\/widgets-[a-f0-9]{16}\.md$/u);
		expect(locations.project.displayPath).toStartWith("github:owner/pi-memory/projects/widgets-");
		expect(locations.project.legacyPath).toBe(path.join(projectRoot, ".agents", "MEMORY.md"));
		expect(locations.project.cachePath).toStartWith(path.join(cacheDir, "cache"));
	});

	test("uses an explicit project id when a repository has no portable remote", async () => {
		const cacheDir = await createTempDir("pi-memory-cache-");
		const projectRoot = await createTempDir("pi-memory-project-");
		await mkdir(path.join(projectRoot, ".jj"));

		const locations = await MemoryLocation.resolve({
			repository: "owner/pi-memory",
			cacheDir,
			cwd: projectRoot,
			projectId: "work/widgets",
		});

		expect(locations.projectIdentity).toBe("explicit:work/widgets");
		expect(locations.project.repositoryPath).toMatch(/^projects\/widgets-[a-f0-9]{16}\.md$/u);
	});
});
