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
			[
				"# Memory",
				"",
				"<!-- pi-memory-entry -->",
				"",
				"User prefers concise answers.",
				"",
				"<!-- pi-memory-entry -->",
				"",
				"Never store temporary task state here.",
				"",
			].join("\n"),
		);
	});

	test("refuses an append that would exceed the file limit", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);

		const result = await MemoryStore.append(paths.globalFile, "x".repeat(100), 80);

		expect(result).toMatchObject({
			type: "error",
			code: "capacity",
			maxBytes: 80,
		});
		expect(await MemoryStore.read(paths.globalFile)).toBe("");
	});

	test("replaces exactly one matching block", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);
		await writeFile(paths.globalFile, "# Memory\n\nUse npm.\n", "utf8");

		const result = await MemoryStore.replace(paths.globalFile, "Use npm.", "Use pnpm.");

		expect(result).toMatchObject({ type: "success" });
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

	test("allows an over-limit file to be reduced but not expanded", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);
		await writeFile(paths.globalFile, `# Memory\n\nprefix-${"x".repeat(100)}-suffix\n`, "utf8");

		expect(
			await MemoryStore.replace(paths.globalFile, "x".repeat(100), "x".repeat(90), 80),
		).toMatchObject({ type: "success" });
		expect(
			await MemoryStore.replace(paths.globalFile, "x".repeat(90), "x".repeat(100), 80),
		).toMatchObject({ type: "error", code: "capacity" });
	});

	test("removes an empty entry marker when an entry is forgotten", async () => {
		const baseDir = await createTempDir("pi-memory-base-");
		const paths = MemoryStore.resolvePaths(baseDir, baseDir);
		await MemoryStore.append(paths.globalFile, "First durable fact.");
		await MemoryStore.append(paths.globalFile, "Second durable fact.");

		expect(await MemoryStore.replace(paths.globalFile, "First durable fact.", "")).toMatchObject({
			type: "success",
		});
		const content = await readFile(paths.globalFile, "utf8");
		expect(content.match(/<!-- pi-memory-entry -->/gu)).toHaveLength(1);
		expect(content).not.toContain("First durable fact.");
		expect(content).toContain("Second durable fact.");
	});
});

describe("MemoryStore.search", () => {
	test("ranks exact phrases and matches code identifiers", () => {
		const matches = MemoryStore.search({
			query: "auth service",
			limit: 5,
			sources: [
				{
					scope: "global",
					filePath: "/memory/MEMORY.md",
					content: [
						"# Memory",
						"",
						"<!-- pi-memory-entry -->",
						"",
						"The AuthService refreshes access tokens.",
						"",
						"<!-- pi-memory-entry -->",
						"",
						"The auth service uses short-lived tokens.",
						"",
					].join("\n"),
				},
			],
		});

		expect(matches).toHaveLength(2);
		expect(matches[0]?.excerpt).toContain("The auth service uses short-lived tokens.");
		expect(matches[1]?.excerpt).toContain("AuthService");
	});

	test("prefers project memory when scores tie and respects the result limit", () => {
		const matches = MemoryStore.search({
			query: "pnpm package manager",
			limit: 1,
			sources: [
				{
					scope: "global",
					filePath: "/global/MEMORY.md",
					content: "# Memory\n\nUse pnpm as the package manager.\n",
				},
				{
					scope: "project",
					filePath: "/project/MEMORY.md",
					content: "# Memory\n\nUse pnpm as the package manager.\n",
				},
			],
		});

		expect(matches).toHaveLength(1);
		expect(matches[0]?.scope).toBe("project");
		expect(matches[0]?.lineStart).toBe(3);
	});

	test("supports identifier prefixes", () => {
		const matches = MemoryStore.search({
			query: "authent",
			limit: 5,
			sources: [
				{
					scope: "project",
					filePath: "/project/MEMORY.md",
					content: "# Memory\n\nAuthentication uses short-lived tokens.\n",
				},
			],
		});

		expect(matches).toHaveLength(1);
		expect(matches[0]?.excerpt).toContain("Authentication");
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

	test("does not inject storage markers", () => {
		const context = MemoryStore.buildContext({
			global: "# Memory\n\n<!-- pi-memory-entry -->\n\nGlobal preference\n",
			project: "",
			globalPath: "/memory/MEMORY.md",
			projectPath: "/memory/projects/app/MEMORY.md",
			projectRoot: "/code/app",
			maxCharsPerScope: 1_000,
		});

		expect(context).toContain("Global preference");
		expect(context).not.toContain("pi-memory-entry");
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
