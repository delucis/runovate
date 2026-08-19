// @ts-check

import { runCommand } from './utils/run-command.js';

export async function run() {
	/** @type {string | undefined} */
	let command = process.argv[2];
	if (process.argv.includes('--version') || process.argv.includes('-v')) {
		command = 'version';
	} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
		command = 'help';
	} else if (!command || command.startsWith('-')) {
		command = 'default';
	}

	return await runCommand(command);
}
