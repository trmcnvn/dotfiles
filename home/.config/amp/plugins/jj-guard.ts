/**
 * JJ Guard
 *
 * Blocks Amp shell tool calls that invoke git directly. Use jj instead.
 */

import type { PluginAPI, ToolCallResult } from '@ampcode/plugin'

const GIT_COMMAND_PATTERN =
	/(^|[;&|()\n])\s*(?:(?:sudo|command)\s+|env\s+(?:\S+=\S+\s+)*)?git(?=\s|$)/i
const QUOTED_TEXT_PATTERN = /'[^']*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g
const HEREDOC_REDIRECT_PATTERN = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|()]+))/g

const GIT_BLOCK_REASON =
	'BLOCKED: Use `jj` commands instead of `git`. Do not run git commands in this environment.'

const getHereDocDelimiters = (line: string): readonly string[] => {
	const delimiters: string[] = []
	for (const match of line.matchAll(HEREDOC_REDIRECT_PATTERN)) {
		const delimiter = match[1] ?? match[2] ?? match[3]
		if (delimiter !== undefined && delimiter.length > 0) {
			delimiters.push(delimiter)
		}
	}
	return delimiters
}

const stripHereDocBodies = (command: string): string => {
	const keptLines: string[] = []
	const pendingDelimiters: string[] = []

	for (const line of command.split('\n')) {
		const pendingDelimiter = pendingDelimiters[0]
		if (pendingDelimiter !== undefined) {
			if (line.trim() === pendingDelimiter) {
				pendingDelimiters.shift()
			}
			continue
		}

		keptLines.push(line)
		pendingDelimiters.push(...getHereDocDelimiters(line))
	}

	return keptLines.join('\n')
}

const commandInvokesGit = (command: string): boolean =>
	GIT_COMMAND_PATTERN.test(stripHereDocBodies(command).replace(QUOTED_TEXT_PATTERN, ''))

export default function jjGuardPlugin(amp: PluginAPI) {
	amp.on('tool.call', (event): ToolCallResult => {
		const shellCommand = amp.helpers.shellCommandFromToolCall(event)
		if (shellCommand === null) return { action: 'allow' }
		if (!commandInvokesGit(shellCommand.command)) return { action: 'allow' }

		return {
			action: 'synthesize',
			result: {
				output: GIT_BLOCK_REASON,
				exitCode: 1,
			},
		}
	})
}
