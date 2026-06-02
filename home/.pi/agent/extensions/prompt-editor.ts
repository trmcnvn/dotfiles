import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";

class PromptEditor extends CustomEditor {
	public labelProvider?: () => string;
	private lockedBorder = false;
	private customBorderColor?: (text: string) => string;

	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
	) {
		super(tui, theme, keybindings);

		Reflect.deleteProperty(this, "borderColor");
		Object.defineProperty(this, "borderColor", {
			get: () => this.customBorderColor ?? ((text: string) => text),
			set: (value: (text: string) => string) => {
				if (this.lockedBorder) return;
				this.customBorderColor = value;
			},
			configurable: true,
			enumerable: true,
		});
	}

	public lockBorderColor(): void {
		this.lockedBorder = true;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const labelText = this.labelProvider?.();
		if (!labelText) return lines;

		const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");
		const topPlain = stripAnsi(lines[0] ?? "");
		const scrollPrefixMatch = topPlain.match(/^(─── ↑ \d+ more )/);
		const prefix = scrollPrefixMatch?.[1] ?? "──";

		let label = labelText;
		const labelLeftSpace = prefix.endsWith(" ") ? "" : " ";
		const labelRightSpace = " ";
		const minRightBorder = 1;
		const maxLabelLength = Math.max(
			0,
			width - prefix.length - labelLeftSpace.length - labelRightSpace.length - minRightBorder,
		);
		if (maxLabelLength <= 0) return lines;
		if (label.length > maxLabelLength) label = label.slice(0, maxLabelLength);

		const labelChunk = `${labelLeftSpace}${label}${labelRightSpace}`;
		const remaining = width - prefix.length - labelChunk.length;
		if (remaining < 0) return lines;

		lines[0] = this.borderColor(prefix) + this.borderColor(labelChunk) + this.borderColor("─".repeat(remaining));
		return lines;
	}
}

function installPromptEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	const uiTheme = ctx.ui.theme;
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const editor = new PromptEditor(tui, theme, keybindings);
		editor.labelProvider = () => "prompt";
		editor.borderColor = (text: string) => {
			const isBashMode = editor.getText().trimStart().startsWith("!");
			if (isBashMode) {
				return uiTheme.getBashModeBorderColor()(text);
			}

			return uiTheme.getThinkingBorderColor(pi.getThinkingLevel())(text);
		};
		editor.lockBorderColor();
		return editor;
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installPromptEditor(pi, ctx);
	});

}
