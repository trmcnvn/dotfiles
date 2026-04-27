export type NotificationWriter = {
	readonly isTTY?: boolean;
	write(chunk: string): unknown;
};

const OSC_777_PREFIX = "\x1b]777;notify;";
const OSC_TERMINATOR = "\x07";
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export const sanitizeOscText = (value: string): string =>
	value.replace(/\x1b\\/g, " ").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();

const sanitizeOscTitle = (title: string): string => sanitizeOscText(title) || "π";

export const formatOsc777Notification = (title: string, body: string): string =>
	`${OSC_777_PREFIX}${sanitizeOscTitle(title)};${sanitizeOscText(body)}${OSC_TERMINATOR}`;

export const canEmitDesktopNotification = (hasUI: boolean, stdout: NotificationWriter): boolean =>
	hasUI && stdout.isTTY === true;

export const emitOsc777Notification = (
	stdout: NotificationWriter,
	hasUI: boolean,
	title: string,
	body: string,
): boolean => {
	if (!canEmitDesktopNotification(hasUI, stdout)) {
		return false;
	}

	stdout.write(formatOsc777Notification(title, body));
	return true;
};
