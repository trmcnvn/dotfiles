import { describe, expect, test } from "bun:test";
import {
	emitOsc777Notification,
	formatOsc777Notification,
	sanitizeOscText,
	type NotificationWriter,
} from "./osc-notification.js";

class CapturingWriter implements NotificationWriter {
	readonly isTTY?: boolean;
	readonly chunks: string[] = [];

	constructor(isTTY: boolean | undefined) {
		this.isTTY = isTTY;
	}

	write(chunk: string): unknown {
		this.chunks.push(chunk);
		return true;
	}
}

const osc777Prefix = "\x1b]777;notify;";
const oscTerminator = "\x07";
const payloadOf = (notification: string): string =>
	notification.slice(osc777Prefix.length, -oscTerminator.length);

describe("OSC desktop notifications", () => {
	test("gates writes to interactive TTY contexts", () => {
		const nonUiTty = new CapturingWriter(true);
		const uiPipe = new CapturingWriter(false);
		const uiUnknown = new CapturingWriter(undefined);
		const uiTty = new CapturingWriter(true);

		expect(emitOsc777Notification(nonUiTty, false, "π", "done")).toBe(false);
		expect(emitOsc777Notification(uiPipe, true, "π", "done")).toBe(false);
		expect(emitOsc777Notification(uiUnknown, true, "π", "done")).toBe(false);
		expect(emitOsc777Notification(uiTty, true, "π", "done")).toBe(true);

		expect(nonUiTty.chunks).toEqual([]);
		expect(uiPipe.chunks).toEqual([]);
		expect(uiUnknown.chunks).toEqual([]);
		expect(uiTty.chunks).toHaveLength(1);
		expect(uiTty.chunks[0]?.startsWith(osc777Prefix)).toBe(true);
		expect(uiTty.chunks[0]?.endsWith(oscTerminator)).toBe(true);
	});

	test("strips OSC terminators and control characters from payload text", () => {
		const rawTitle = "pi\x07\x1b\\\x1b]777;notify;evil;title\u009d";
		const rawBody = "body\x00\r\n\t\x1b[31mred\x07\x1b\\after\u009b31m";
		const notification = formatOsc777Notification(rawTitle, rawBody);
		const payload = payloadOf(notification);

		expect(notification.startsWith(osc777Prefix)).toBe(true);
		expect(notification.endsWith(oscTerminator)).toBe(true);
		expect(payload).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
		expect(payload).not.toContain("\x1b\\");
		expect(payload).not.toContain("\x1b[31m");
		expect(payload).not.toContain("\x07");
		expect(payload).toContain("evil;title");
		expect(payload).toContain("body [31mred after 31m");
	});

	test("falls back to a safe title when sanitization empties the title", () => {
		expect(sanitizeOscText("\x07\x1b\u009b")).toBe("");
		expect(formatOsc777Notification("\x07\x1b", "ready")).toBe("\x1b]777;notify;π;ready\x07");
	});
});
