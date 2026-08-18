// @ts-check

import { log } from '@clack/prompts';
import fmt from 'femtocolors';
import { error } from './utils/colors.js';
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

	switch (command) {
		case 'default':
		case 'help':
		case 'version':
		case 'logout':
			return await runCommand(command);
		default:
			log.error(error(`Unknown command: ${fmt.bold(command)}`));
			process.exit(1);
	}
}
