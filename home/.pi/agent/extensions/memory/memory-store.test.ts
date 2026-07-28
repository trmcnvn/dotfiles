import { describe, expect, test } from "bun:test";
import { MemoryStore } from "./memory-store";

describe("MemoryStore mutations", () => {
	test("creates a Markdown memory document and appends entries", () => {
		const first = MemoryStore.append("", "User prefers concise answers.");
		expect(first.type).toBe("success");
		if (first.type === "error") return;
		const second = MemoryStore.append(first.content, "Never store temporary task state here.");
		expect(second.type).toBe("success");
		if (second.type === "error") return;

		expect(second.content).toBe(
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

	test("refuses an append that would exceed the document limit", () => {
		expect(MemoryStore.append("", "x".repeat(100), 80)).toMatchObject({
			type: "error",
			code: "capacity",
			maxBytes: 80,
		});
	});

	test("replaces exactly one matching block", () => {
		const result = MemoryStore.replace("# Memory\n\nUse npm.\n", "Use npm.", "Use pnpm.");
		expect(result).toMatchObject({ type: "success" });
		if (result.type === "success") expect(result.content).toBe("# Memory\n\nUse pnpm.\n");
	});

	test("rejects missing and ambiguous replacements", () => {
		expect(MemoryStore.replace("same\nsame\n", "missing", "new")).toMatchObject({
			type: "error",
			code: "not-found",
		});
		expect(MemoryStore.replace("same\nsame\n", "same", "new")).toMatchObject({
			type: "error",
			code: "ambiguous",
		});
	});

	test("allows an over-limit document to be reduced but not expanded", () => {
		const existing = `# Memory\n\nprefix-${"x".repeat(100)}-suffix\n`;
		const reduced = MemoryStore.replace(existing, "x".repeat(100), "x".repeat(90), 80);
		expect(reduced).toMatchObject({ type: "success" });
		if (reduced.type === "error") return;
		expect(MemoryStore.replace(reduced.content, "x".repeat(90), "x".repeat(100), 80)).toMatchObject({
			type: "error",
			code: "capacity",
		});
	});

	test("removes an empty entry marker when an entry is forgotten", () => {
		const first = MemoryStore.append("", "First durable fact.");
		if (first.type === "error") throw new Error(first.message);
		const second = MemoryStore.append(first.content, "Second durable fact.");
		if (second.type === "error") throw new Error(second.message);
		const replaced = MemoryStore.replace(second.content, "First durable fact.", "");
		expect(replaced).toMatchObject({ type: "success" });
		if (replaced.type === "error") return;
		expect(replaced.content.match(/<!-- pi-memory-entry -->/gu)).toHaveLength(1);
		expect(replaced.content).not.toContain("First durable fact.");
		expect(replaced.content).toContain("Second durable fact.");
	});
});

describe("MemoryStore.search", () => {
	test("ranks exact phrases and matches code identifiers", () => {
		const matches = MemoryStore.search({
			query: "auth service",
			limit: 5,
			sources: [{
				scope: "global",
				filePath: "github:owner/memory/global.md",
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
			}],
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
				{ scope: "global", filePath: "global.md", content: "# Memory\n\nUse pnpm as the package manager.\n" },
				{ scope: "project", filePath: "project.md", content: "# Memory\n\nUse pnpm as the package manager.\n" },
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
			sources: [{ scope: "project", filePath: "project.md", content: "# Memory\n\nAuthentication uses short-lived tokens.\n" }],
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
			globalPath: "github:owner/memory/global.md",
			projectPath: "github:owner/memory/projects/app.md",
			projectRoot: "/code/app",
			maxCharsPerScope: 1_000,
		});
		expect(context).toContain("Global preference");
		expect(context).toContain("Project decision");
		expect(context).toContain("github:owner/memory/global.md");
		expect(context).toContain("/code/app");
		expect(context).not.toMatch(/generated|updated|\d{4}-\d{2}-\d{2}/i);
	});

	test("does not inject storage markers", () => {
		const context = MemoryStore.buildContext({
			global: "# Memory\n\n<!-- pi-memory-entry -->\n\nGlobal preference\n",
			project: "",
			globalPath: "global.md",
			projectPath: "project.md",
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
			globalPath: "global.md",
			projectPath: "project.md",
			projectRoot: "/code/app",
			maxCharsPerScope: 80,
		});
		expect(context).toContain("BEGIN");
		expect(context).toContain("END");
		expect(context).toContain("memory truncated");
	});
});
