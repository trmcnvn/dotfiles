import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/** Maximum bytes read from a worker session file in one call. */
export const ACTIVITY_READ_BYTES = 64 * 1024;
/** Maximum rendered activity returned in one call. */
export const ACTIVITY_OUTPUT_BYTES = 20 * 1024;
const EVENT_BYTES = 2 * 1024;
const MAX_EVENTS = 50;

const continuityAnchorSchema = Type.Object({
	position: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	length: Type.Integer({ minimum: 1, maximum: 64 }),
	hash: Type.String({ minLength: 1 }),
});
type ContinuityAnchor = Static<typeof continuityAnchorSchema>;

const activityCursorSchema = Type.Object({
	version: Type.Literal(2),
	worker: Type.String(),
	sessionHash: Type.String(),
	device: Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
	inode: Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
	observedSize: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	offset: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	scanOffset: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	offsetAnchor: continuityAnchorSchema,
	scanAnchor: continuityAnchorSchema,
	headerId: Type.String({ minLength: 1 }),
});
type ActivityCursor = Static<typeof activityCursorSchema>;

const stringSchema = Type.String();
const booleanSchema = Type.Boolean();
const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const unknownArraySchema = Type.Array(Type.Unknown());
const contentPartRepresentationSchema = Type.Object({
	type: Type.Optional(Type.Unknown()),
	text: Type.Optional(Type.Unknown()),
	name: Type.Optional(Type.Unknown()),
	id: Type.Optional(Type.Unknown()),
	arguments: Type.Optional(Type.Unknown()),
});
const messageRepresentationSchema = Type.Object({
	role: Type.Optional(Type.Unknown()),
	content: Type.Optional(Type.Unknown()),
	errorMessage: Type.Optional(Type.Unknown()),
	toolName: Type.Optional(Type.Unknown()),
	toolCallId: Type.Optional(Type.Unknown()),
	isError: Type.Optional(Type.Unknown()),
});
const sessionEntryRepresentationSchema = Type.Object({
	type: Type.Optional(Type.Unknown()),
	id: Type.Optional(Type.Unknown()),
	parentId: Type.Optional(Type.Unknown()),
	message: Type.Optional(Type.Unknown()),
	summary: Type.Optional(Type.Unknown()),
	fromId: Type.Optional(Type.Unknown()),
});

type ActivityContentPart =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "toolCall"; readonly name: string; readonly id?: string; readonly argumentsText: string };

type ActivityMessage = {
	readonly role?: string;
	readonly textContent?: string;
	readonly parts?: readonly ActivityContentPart[];
	readonly errorMessage?: string;
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly isError?: boolean;
};

type ActivityToolCallDraft = {
	kind: "toolCall";
	name: string;
	id?: string;
	argumentsText: string;
};

type ActivityMessageDraft = {
	role?: string;
	textContent?: string;
	parts?: readonly ActivityContentPart[];
	errorMessage?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
};

type SessionEntry = {
	readonly type?: string;
	readonly id?: string;
	readonly parentId?: string | null;
	readonly message?: ActivityMessage;
	readonly summary?: string;
	readonly fromId?: string;
};

type SessionEntryDraft = {
	type?: string;
	id?: string;
	parentId?: string | null;
	message?: ActivityMessage;
	summary?: string;
	fromId?: string;
};

const sessionHeaderSchema = Type.Object({
	type: Type.Literal("session"),
	id: Type.String({ minLength: 1 }),
});

/** Input for a bounded, repeatable worker activity read. */
export type ReadAgentActivityInput = {
	readonly worker: string;
	readonly cursor?: string;
};

/** One bounded activity page and an opaque continuation cursor. */
export type AgentActivity = {
	readonly worker: string;
	readonly activity: string;
	readonly cursor: string;
	readonly hasMore: boolean;
	readonly incompleteTrailingLine: boolean;
};

/** Expected session activity parsing or cursor failure. */
export class AgentActivityError extends Error {
	/** Stable failure category. */
	readonly code: string;

	/** Creates a safely classified activity reader failure. */
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

function sessionHash(path: string): string {
	return createHash("sha256").update(path).digest("base64url");
}

function encodeCursor(cursor: ActivityCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseCursor(encoded: string, worker: string, session: string): ActivityCursor {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		throw new AgentActivityError("activity_cursor_invalid", "cursor is not valid");
	}
	if (!Value.Check(activityCursorSchema, value) || value.worker !== worker ||
		value.sessionHash !== sessionHash(session) || value.scanOffset < value.offset) {
		throw new AgentActivityError("activity_cursor_mismatch", "cursor does not belong to this owned worker session");
	}
	if (value.offsetAnchor.position + value.offsetAnchor.length > value.observedSize ||
		value.scanAnchor.position + value.scanAnchor.length > value.observedSize) {
		throw new AgentActivityError("activity_cursor_mismatch", "cursor continuity anchors exceed the observed session");
	}
	return value;
}

async function createAnchor(file: Awaited<ReturnType<typeof open>>, boundary: number, observedEnd: number): Promise<ContinuityAnchor> {
	const position = Math.max(0, boundary - 32);
	const length = Math.min(64, observedEnd - position);
	if (length < 1) throw new AgentActivityError("activity_cursor_invalid", "continuity anchor could not be created");
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await file.read(buffer, 0, length, position);
	if (bytesRead !== length) throw new AgentActivityError("activity_file_changed", "session changed while issuing the activity cursor");
	return { position, length, hash: createHash("sha256").update(buffer).digest("base64url") };
}

async function makeCursor(
	file: Awaited<ReturnType<typeof open>>,
	input: Omit<ActivityCursor, "version" | "offsetAnchor" | "scanAnchor">,
	observedEnd: number,
): Promise<string> {
	const [offsetAnchor, scanAnchor] = await Promise.all([
		createAnchor(file, input.offset, observedEnd),
		createAnchor(file, input.scanOffset, observedEnd),
	]);
	return encodeCursor({ version: 2, ...input, offsetAnchor, scanAnchor });
}

async function verifyAnchor(file: Awaited<ReturnType<typeof open>>, anchor: ContinuityAnchor): Promise<void> {
	const buffer = Buffer.alloc(anchor.length);
	const { bytesRead } = await file.read(buffer, 0, anchor.length, anchor.position);
	const hash = createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("base64url");
	if (bytesRead !== anchor.length || hash !== anchor.hash) {
		throw new AgentActivityError("activity_file_changed", "bounded session continuity check failed");
	}
}

function truncate(value: string, bytes = EVENT_BYTES): string {
	if (Buffer.byteLength(value, "utf8") <= bytes) return value;
	const suffix = "…";
	let result = "";
	for (const character of value) {
		if (Buffer.byteLength(result + character + suffix, "utf8") > bytes) break;
		result += character;
	}
	return result + suffix;
}

function parseActivityMessage(value: Static<typeof messageRepresentationSchema>): ActivityMessage {
	const message: ActivityMessageDraft = {};
	if (Value.Check(stringSchema, value.role)) message.role = value.role;
	if (Value.Check(stringSchema, value.content)) message.textContent = value.content;
	if (Value.Check(stringSchema, value.errorMessage)) message.errorMessage = value.errorMessage;
	if (Value.Check(stringSchema, value.toolName)) message.toolName = value.toolName;
	if (Value.Check(stringSchema, value.toolCallId)) message.toolCallId = value.toolCallId;
	if (Value.Check(booleanSchema, value.isError)) message.isError = value.isError;
	if (Value.Check(unknownArraySchema, value.content)) {
		const parts: ActivityContentPart[] = [];
		for (const rawPart of value.content) {
			if (!Value.Check(contentPartRepresentationSchema, rawPart)) continue;
			if (rawPart.type === "text" && Value.Check(stringSchema, rawPart.text)) {
				parts.push({ kind: "text", text: rawPart.text });
			}
			if (rawPart.type === "toolCall" && Value.Check(stringSchema, rawPart.name)) {
				const part: ActivityToolCallDraft = {
					kind: "toolCall",
					name: rawPart.name,
					argumentsText: JSON.stringify(rawPart.arguments ?? {}) ?? "{}",
				};
				if (Value.Check(stringSchema, rawPart.id)) part.id = rawPart.id;
				parts.push(part);
			}
		}
		message.parts = parts;
	}
	return message;
}

function parseSessionEntry(value: Static<typeof sessionEntryRepresentationSchema>): SessionEntry {
	const entry: SessionEntryDraft = {};
	if (Value.Check(stringSchema, value.type)) entry.type = value.type;
	if (Value.Check(stringSchema, value.id)) entry.id = value.id;
	if (Value.Check(nullableStringSchema, value.parentId)) entry.parentId = value.parentId;
	if (Value.Check(messageRepresentationSchema, value.message)) entry.message = parseActivityMessage(value.message);
	if (Value.Check(stringSchema, value.summary)) entry.summary = value.summary;
	if (Value.Check(stringSchema, value.fromId)) entry.fromId = value.fromId;
	return entry;
}

function contentText(message: ActivityMessage): string {
	if (message.textContent !== undefined) return message.textContent;
	return message.parts?.flatMap((part) => part.kind === "text" ? [part.text] : []).join("\n") ?? "";
}

function renderEntry(entry: SessionEntry, lineNumber: number): string | undefined {
	const type = entry.type ?? "unknown";
	const id = entry.id ?? `line-${lineNumber}`;
	const parent = entry.parentId ?? (entry.parentId === null ? "root" : "unknown");
	const prefix = `[${id} ${type} parent=${parent}]`;
	if (type === "message") {
		const message = entry.message;
		if (message?.role === "assistant") {
			const rendered: string[] = [];
			for (const part of message.parts ?? []) {
				if (part.kind === "text" && part.text) rendered.push(`assistant: ${truncate(part.text)}`);
				if (part.kind === "toolCall") {
					const callId = part.id ? ` ${part.id}` : "";
					rendered.push(`tool call${callId} ${part.name}: ${truncate(part.argumentsText)}`);
				}
			}
			if (message.errorMessage) rendered.push(`assistant error: ${truncate(message.errorMessage)}`);
			return rendered.length ? truncate(`[${id} ${type}/assistant parent=${parent}] ${rendered.join("\n")}`) : undefined;
		}
		if (message?.role === "toolResult") {
			const name = message.toolName ?? "unknown";
			const callId = message.toolCallId ? ` ${message.toolCallId}` : "";
			const marker = message.isError === true ? " error" : "";
			return truncate(`[${id} ${type}/toolResult parent=${parent}] ${name}${callId}${marker}: ${truncate(contentText(message) || "(no text output)")}`);
		}
		return undefined;
	}
	if (type === "compaction") return truncate(`${prefix} ${truncate(entry.summary ?? "context compacted")}`);
	if (type === "branch_summary") {
		const from = entry.fromId ? ` from=${entry.fromId}` : "";
		return truncate(`${prefix.slice(0, -1)}${from}] ${truncate(entry.summary ?? "branch changed")}`);
	}
	return undefined;
}

async function readHeader(file: Awaited<ReturnType<typeof open>>): Promise<{ readonly id: string; readonly bytes: number }> {
	const buffer = Buffer.alloc(16 * 1024);
	const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
	const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
	if (newline < 0) throw new AgentActivityError("activity_header_invalid", "session header is missing or exceeds 16 KB");
	let value: unknown;
	try {
		value = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
	} catch {
		throw new AgentActivityError("activity_header_invalid", "session header is malformed");
	}
	if (!Value.Check(sessionHeaderSchema, value)) {
		throw new AgentActivityError("activity_header_invalid", "session header identity is missing");
	}
	return { id: value.id, bytes: newline + 1 };
}

/** Reads an owned Pi JSONL session incrementally without reconstructing conversation state. */
export async function readSessionActivity(
	worker: string,
	session: string,
	cursor?: string,
): Promise<AgentActivity> {
	const file = await open(session, "r").catch(() => {
		throw new AgentActivityError("activity_unavailable", "owned worker session cannot be read");
	});
	try {
		const stats = await file.stat();
		if (!stats.isFile()) throw new AgentActivityError("activity_unavailable", "owned worker session is not a regular file");
		const header = await readHeader(file);
		const filenameIdentity = /^.+_([0-9a-f-]{20,})\.jsonl$/i.exec(basename(session))?.[1];
		if (filenameIdentity && filenameIdentity !== header.id) throw new AgentActivityError("activity_identity_mismatch", "native session and JSONL header do not match");
		const parsed = cursor ? parseCursor(cursor, worker, session) : undefined;
		if (parsed && (parsed.device !== stats.dev || parsed.inode !== stats.ino)) throw new AgentActivityError("activity_file_replaced", "owned worker session file was replaced");
		if (parsed && parsed.headerId !== header.id) throw new AgentActivityError("activity_identity_mismatch", "session header changed since the cursor was issued");
		if (parsed && stats.size < parsed.observedSize) throw new AgentActivityError("activity_file_truncated", "owned worker session became smaller than the cursor observation");
		if (parsed) await Promise.all([verifyAnchor(file, parsed.offsetAnchor), verifyAnchor(file, parsed.scanAnchor)]);
		const offset = parsed?.offset ?? header.bytes;
		const scanOffset = parsed?.scanOffset ?? offset;
		if (offset < header.bytes || scanOffset < offset) throw new AgentActivityError("activity_cursor_mismatch", "cursor is outside session record boundaries");
		if (stats.size < offset || stats.size < scanOffset) throw new AgentActivityError("activity_file_truncated", "owned worker session file was truncated");
		if (offset > header.bytes) {
			const previous = Buffer.alloc(1);
			await file.read(previous, 0, 1, offset - 1);
			if (previous[0] !== 0x0a) throw new AgentActivityError("activity_cursor_mismatch", "cursor offset is not a JSONL record boundary");
		}
		const length = Math.min(ACTIVITY_READ_BYTES, stats.size - scanOffset);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await file.read(buffer, 0, length, scanOffset);
		const bytes = buffer.subarray(0, bytesRead);
		if (scanOffset > offset) {
			const newline = bytes.indexOf(0x0a);
			if (newline < 0) {
				return {
					worker,
					activity: "(oversized JSONL record is still being scanned within bounded pages)",
					cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset, scanOffset: scanOffset + bytesRead, headerId: header.id }, scanOffset + bytesRead),
					hasMore: scanOffset + bytesRead < stats.size,
					incompleteTrailingLine: scanOffset + bytesRead >= stats.size,
				};
			}
			const nextOffset = scanOffset + newline + 1;
			const marker = truncate(`[oversized-record message parent=unknown] record larger than ${ACTIVITY_READ_BYTES} bytes omitted`);
			return {
				worker,
				activity: marker,
				cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset: nextOffset, scanOffset: nextOffset, headerId: header.id }, scanOffset + bytesRead),
				hasMore: nextOffset < stats.size,
				incompleteTrailingLine: false,
			};
		}
		const events: string[] = [];
		let consumed = 0;
		let lineNumber = 1;
		let outputBytes = 0;
		let stoppedForLimit = false;
		let stoppedForMissingNewline = false;
		while (consumed < bytes.length) {
			if (events.length >= MAX_EVENTS) {
				stoppedForLimit = true;
				break;
			}
			const relativeNewline = bytes.subarray(consumed).indexOf(0x0a);
			if (relativeNewline < 0) {
				stoppedForMissingNewline = true;
				break;
			}
			const end = consumed + relativeNewline;
			const line = bytes.subarray(consumed, end).toString("utf8");
			let rendered: string | undefined;
			try {
				const entry: unknown = JSON.parse(line);
				rendered = Value.Check(sessionEntryRepresentationSchema, entry)
					? renderEntry(parseSessionEntry(entry), lineNumber)
					: `[line ${lineNumber} malformed] expected object`;
			} catch {
				rendered = `[line ${lineNumber} malformed] invalid JSON record`;
			}
			if (rendered) {
				rendered = truncate(rendered);
				const separatorBytes = events.length > 0 ? 2 : 0;
				const renderedBytes = Buffer.byteLength(rendered, "utf8");
				if (outputBytes + separatorBytes + renderedBytes > ACTIVITY_OUTPUT_BYTES) {
					stoppedForLimit = true;
					break;
				}
				events.push(rendered);
				outputBytes += separatorBytes + renderedBytes;
			}
			consumed = end + 1;
			lineNumber += 1;
		}
		const nextOffset = offset + consumed;
		const incompleteTrailingLine = stoppedForMissingNewline && offset + bytes.length >= stats.size;
		const nextScanOffset = stoppedForMissingNewline && consumed === 0 && bytes.length === ACTIVITY_READ_BYTES
			? offset + bytes.length
			: nextOffset;
		return {
			worker,
			activity: events.join("\n\n") || "(no assistant/tool activity in this page)",
			cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset: nextOffset, scanOffset: nextScanOffset, headerId: header.id }, scanOffset + bytesRead),
			hasMore: stoppedForLimit || (nextScanOffset < stats.size && !incompleteTrailingLine),
			incompleteTrailingLine,
		};
	} finally {
		await file.close();
	}
}
