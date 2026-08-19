import { log, outro } from '@clack/prompts';
import fmt from 'femtocolors';
import { error, info } from './colors.js';

/**
 * Load and run a CLI command based on the given command name.
 * @param command {string} - The command to run, e.g. `"help"`, `"version"`, etc. Should correspond
 * to a file in the `src/commands` directory, e.g. `"help"` will run `src/commands/help.js`.
 * @returns {Promise<void>}
 */
export async function runCommand(command) {
	let cmd;
	try {
		const mod = await import(`../commands/${command}.js`);
		cmd = mod.default;
	} catch {}

	if (!cmd) {
		log.error(error(`Unknown command: ${fmt.bold(command)}`));
		outro(`Run ${info.bold('runovate help')} to see a list of available commands.`);
		process.exit(1);
	}

	return await cmd();
}
