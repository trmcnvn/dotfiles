import { describe, expect, test } from "bun:test";
import {
	getDesktopNotificationCommands,
	sendDesktopNotificationWithRunner,
	type DesktopNotificationCommand,
} from "./desktop-notification.js";

describe("desktop notification popups", () => {
	test("skips notification commands without UI", async () => {
		const calls: DesktopNotificationCommand[] = [];
		const sent = await sendDesktopNotificationWithRunner(false, "π", "ready", async (candidate) => {
			calls.push(candidate);
			return true;
		});

		expect(sent).toBe(false);
		expect(calls).toEqual([]);
	});

	test("uses libnotify for desktop-environment popups", () => {
		expect(getDesktopNotificationCommands("π", "ready")).toEqual([
			{
				command: "notify-send",
				args: ["--app-name=pi", "--urgency=normal", "--icon=dialog-information", "π", "ready"],
			},
		]);
	});

	test("reports true when the popup command succeeds", async () => {
		const calls: DesktopNotificationCommand[] = [];
		const sent = await sendDesktopNotificationWithRunner(true, "π", "ready", async (candidate) => {
			calls.push(candidate);
			return true;
		});

		expect(sent).toBe(true);
		expect(calls).toEqual(getDesktopNotificationCommands("π", "ready"));
	});

	test("reports false when no popup command works", async () => {
		const calls: DesktopNotificationCommand[] = [];
		const sent = await sendDesktopNotificationWithRunner(true, "π", "ready", async (candidate) => {
			calls.push(candidate);
			return false;
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(getDesktopNotificationCommands("π", "ready"));
	});

	test("continues to fallback commands when a runner rejects", async () => {
		const calls: DesktopNotificationCommand[] = [];
		const sent = await sendDesktopNotificationWithRunner(true, "π", "ready", async (candidate) => {
			calls.push(candidate);
			throw new Error("not available");
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(getDesktopNotificationCommands("π", "ready"));
	});
});
