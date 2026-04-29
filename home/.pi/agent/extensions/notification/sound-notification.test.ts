import { describe, expect, test } from "bun:test";
import {
	getNotificationSoundCommands,
	playNotificationSoundWithRunner,
	type SoundCommand,
} from "./sound-notification.js";

describe("desktop-environment sound notifications", () => {
	test("skips sound commands without UI", async () => {
		const calls: SoundCommand[] = [];
		const played = await playNotificationSoundWithRunner(false, async (candidate) => {
			calls.push(candidate);
			return true;
		});

		expect(played).toBe(false);
		expect(calls).toEqual([]);
	});

	test("tries the current DE sound theme before raw audio players", () => {
		expect(getNotificationSoundCommands()[0]).toEqual({
			command: "canberra-gtk-play",
			args: ["-i", "message-new-instant"],
		});
	});

	test("stops after the first playable sound command", async () => {
		const calls: SoundCommand[] = [];
		const played = await playNotificationSoundWithRunner(true, async (candidate) => {
			calls.push(candidate);
			return candidate.command === "paplay";
		});

		expect(played).toBe(true);
		expect(calls.map((call) => call.command)).toEqual(["canberra-gtk-play", "paplay"]);
	});

	test("reports false when no sound command works", async () => {
		const calls: SoundCommand[] = [];
		const played = await playNotificationSoundWithRunner(true, async (candidate) => {
			calls.push(candidate);
			return false;
		});

		expect(played).toBe(false);
		expect(calls).toEqual(getNotificationSoundCommands());
	});

	test("continues to fallback commands when a runner rejects", async () => {
		const calls: SoundCommand[] = [];
		const played = await playNotificationSoundWithRunner(true, async (candidate) => {
			calls.push(candidate);
			if (candidate.command === "canberra-gtk-play") {
				throw new Error("not available");
			}
			return candidate.command === "paplay";
		});

		expect(played).toBe(true);
		expect(calls.map((call) => call.command)).toEqual(["canberra-gtk-play", "paplay"]);
	});
});
