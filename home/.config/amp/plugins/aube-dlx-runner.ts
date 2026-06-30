/**
 * Aube DLX Runner
 *
 * Rewrites package runner invocations in Amp shell tool calls so `npx`, `bunx`,
 * and `pnpx` execute through `aube dlx` instead.
 */

import type { PluginAPI, ToolCallResult } from '@ampcode/plugin'

const PACKAGE_RUNNER_COMMAND_PATTERN =
	/(^|[;&|()\n])(\s*)((?:(?:sudo|command)\s+|env\s+(?:\S+=\S+\s+)*)?)(npx|bunx|pnpx)(?=\s|$)/gi

const rewritePackageRunnerCommands = (command: string): string =>
	command.replace(PACKAGE_RUNNER_COMMAND_PATTERN, (_match, separator, spacing, prefix) => {
		return `${separator}${spacing}${prefix}aube dlx`
	})

const rewriteShellToolInput = (input: Record<string, unknown>, command: string): Record<string, unknown> => {
	const rewrittenCommand = rewritePackageRunnerCommands(command)
	const rewrittenInput = { ...input }

	if (typeof rewrittenInput.command === 'string') {
		rewrittenInput.command = rewritePackageRunnerCommands(rewrittenInput.command)
		return rewrittenInput
	}

	if (typeof rewrittenInput.cmd === 'string') {
		rewrittenInput.cmd = rewritePackageRunnerCommands(rewrittenInput.cmd)
		return rewrittenInput
	}

	return { ...rewrittenInput, command: rewrittenCommand }
}

export default function aubeDlxRunnerPlugin(amp: PluginAPI) {
	amp.on('tool.call', (event): ToolCallResult => {
		const shellCommand = amp.helpers.shellCommandFromToolCall(event)
		if (shellCommand === null) return { action: 'allow' }

		const rewrittenCommand = rewritePackageRunnerCommands(shellCommand.command)
		if (rewrittenCommand === shellCommand.command) return { action: 'allow' }

		return {
			action: 'modify',
			input: rewriteShellToolInput(event.input, shellCommand.command),
		}
	})
}
