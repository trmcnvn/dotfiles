import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "./memory-store";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), prefix));
	tempDirs.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("MemoryStore.resolvePaths", () => {
	test("uses the nearest repository marker for project memory", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const projectRoot = await createTempDir("pi-memory-project-");
		const nestedDirectory = path.join(projectRoot, "src", "feature");
		await Promise.all([mkdir(path.join(projectRoot, ".jj")), mkdir(nestedDirectory, { recursive: true })]);

		const paths = MemoryStore.resolvePaths(baseDir, nestedDirectory);

		expect(paths.projectRoot).toBe(projectRoot);
		expect(paths.globalFile).toBe(path.join(baseDir, "MEMORY.md"));
		expect(paths.projectFile).toBe(path.join(projectRoot, ".agents", "MEMORY.md"));
	});

	test("keeps each project's memory inside that project", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const projectA = await createTempDir("pi-memory-project-a-");
		const projectB = await createTempDir("pi-memory-project-b-");
		await Promise.all([mkdir(path.join(projectA, ".git")), mkdir(path.join(projectB, ".git"))]);

		const pathsA = MemoryStore.resolvePaths(baseDir, projectA);
		const pathsB = MemoryStore.resolvePaths(baseDir, projectB);

		expect(pathsA.projectFile).toBe(path.join(projectA, ".agents", "MEMORY.md"));
		expect(pathsB.projectFile).toBe(path.join(projectB, ".agents", "MEMORY.md"));
	});
});

describe("MemoryStore mutations", () => {
	test("creates a Markdown memory file and appends entries", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);

		await MemoryStore.append(paths.globalFile, "User prefers concise answers.");
		await MemoryStore.append(paths.globalFile, "Never store temporary task state here.");

		expect(await readFile(paths.globalFile, "utf8")).toBe(
			"# Memory\n\nUser prefers concise answers.\n\nNever store temporary task state here.\n",
		);
	});

	test("replaces exactly one matching block", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);
		await writeFile(paths.globalFile, "# Memory\n\nUse npm.\n", "utf8");

		const result = await MemoryStore.replace(paths.globalFile, "Use npm.", "Use pnpm.");

		expect(result).toEqual({ type: "success" });
		expect(await readFile(paths.globalFile, "utf8")).toBe("# Memory\n\nUse pnpm.\n");
	});

	test("rejects missing and ambiguous replacements", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);
		await writeFile(paths.globalFile, "same\nsame\n", "utf8");

		expect(await MemoryStore.replace(paths.globalFile, "missing", "new")).toMatchObject({
			type: "error",
			code: "not-found",
		});
		expect(await MemoryStore.replace(paths.globalFile, "same", "new")).toMatchObject({
			type: "error",
			code: "ambiguous",
		});
	});
});

describe("MemoryStore.buildContext", () => {
	test("includes global and project memories without adding volatile text", () => {
		const context = MemoryStore.buildContext({
			global: "Global preference",
			project: "Project decision",
			globalPath: "/memory/MEMORY.md",
			projectPath: "/memory/projects/app/MEMORY.md",
			projectRoot: "/code/app",
			maxCharsPerScope: 1_000,
		});

		expect(context).toContain("Global preference");
		expect(context).toContain("Project decision");
		expect(context).toContain("/memory/MEMORY.md");
		expect(context).toContain("/code/app");
		expect(context).not.toMatch(/generated|updated|\d{4}-\d{2}-\d{2}/i);
	});

	test("preserves the beginning and end when memory is truncated", () => {
		const context = MemoryStore.buildContext({
			global: `BEGIN-${"x".repeat(200)}-END`,
			project: "",
			globalPath: "/memory/MEMORY.md",
			projectPath: "/memory/projects/app/MEMORY.md",
			projectRoot: "/code/app",
			maxCharsPerScope: 80,
		});

		expect(context).toContain("BEGIN");
		expect(context).toContain("END");
		expect(context).toContain("memory truncated");
	});
});
