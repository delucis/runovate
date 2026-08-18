import { parse } from '@bomb.sh/args';
import { log, outro } from '@clack/prompts';
import { error, info } from './colors.js';

/**
 * Parse CLI arguments with `@bomb.sh/args` and exit if any unknown options are found.
 * @type {typeof parse}
 */
export function strictParse(argv, options) {
	const validKeys = new Set([
		'_',
		...Object.values(options?.string || []),
		...Object.values(options?.boolean || []),
		...Object.values(options?.array || []),
		...Object.keys(options?.alias || {}),
		...Object.entries(options?.default || {}).flat(),
	]);

	const args = parse(argv, options);

	/** @type {string[]} */
	const errors = [];
	for (const key in args) {
		if (!validKeys.has(key)) errors.push(key);
	}
	if (errors.length > 0) {
		log.error(error(`Unknown options: ${errors.map((key) => `--${key}`).join(', ')}`));
		outro(`Run ${info.bold('runovate help')} to see a list of available options.`);
		process.exit(1);
	}

	return /** @type {any} */ (args);
}
