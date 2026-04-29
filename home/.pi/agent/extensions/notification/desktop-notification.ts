import { execFile } from "node:child_process";

export type DesktopNotificationCommand = {
	readonly command: string;
	readonly args: readonly string[];
};

export type DesktopNotificationCommandRunner = (candidate: DesktopNotificationCommand) => Promise<boolean>;

const DESKTOP_NOTIFICATION_TIMEOUT_MS = 2_000;

export const getDesktopNotificationCommands = (title: string, body: string): readonly DesktopNotificationCommand[] => [
	{
		command: "notify-send",
		args: ["--app-name=pi", "--urgency=normal", "--icon=dialog-information", title, body],
	},
];

const runDesktopNotificationCommand: DesktopNotificationCommandRunner = (candidate) =>
	new Promise((resolve) => {
		try {
			execFile(
				candidate.command,
				[...candidate.args],
				{ timeout: DESKTOP_NOTIFICATION_TIMEOUT_MS, windowsHide: true },
				(error) => resolve(error === null),
			);
		} catch {
			resolve(false);
		}
	});

export const sendDesktopNotificationWithRunner = async (
	hasUI: boolean,
	title: string,
	body: string,
	runCommand: DesktopNotificationCommandRunner,
): Promise<boolean> => {
	if (!hasUI) {
		return false;
	}

	for (const candidate of getDesktopNotificationCommands(title, body)) {
		try {
			if (await runCommand(candidate)) {
				return true;
			}
		} catch {
			// Try the next available notification backend.
		}
	}

	return false;
};

export const sendDesktopNotification = (hasUI: boolean, title: string, body: string): Promise<boolean> =>
	sendDesktopNotificationWithRunner(hasUI, title, body, runDesktopNotificationCommand);
