import { execFile } from "node:child_process";

export type SoundCommand = {
	readonly command: string;
	readonly args: readonly string[];
};

export type SoundCommandRunner = (candidate: SoundCommand) => Promise<boolean>;

const SOUND_COMMAND_TIMEOUT_MS = 2_000;

const notificationSoundCommands: readonly SoundCommand[] = [
	{ command: "canberra-gtk-play", args: ["-i", "message-new-instant"] },
	{ command: "paplay", args: ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"] },
	{ command: "paplay", args: ["/usr/share/sounds/freedesktop/stereo/complete.oga"] },
	{ command: "pw-play", args: ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"] },
	{ command: "aplay", args: ["/usr/share/sounds/alsa/Front_Center.wav"] },
] as const;

export const getNotificationSoundCommands = (): readonly SoundCommand[] => notificationSoundCommands;

const runSoundCommand: SoundCommandRunner = (candidate) =>
	new Promise((resolve) => {
		try {
			execFile(
				candidate.command,
				[...candidate.args],
				{ timeout: SOUND_COMMAND_TIMEOUT_MS, windowsHide: true },
				(error) => resolve(error === null),
			);
		} catch {
			resolve(false);
		}
	});

export const playNotificationSoundWithRunner = async (
	hasUI: boolean,
	runCommand: SoundCommandRunner,
): Promise<boolean> => {
	if (!hasUI) {
		return false;
	}

	for (const candidate of notificationSoundCommands) {
		try {
			if (await runCommand(candidate)) {
				return true;
			}
		} catch {
			// Try the next available sound backend.
		}
	}

	return false;
};

export const playNotificationSound = (hasUI: boolean): Promise<boolean> =>
	playNotificationSoundWithRunner(hasUI, runSoundCommand);
