import { log, outro } from '@clack/prompts';
import fmt from 'femtocolors';
import { info } from '../utils/colors.js';
import { printHeader } from '../utils/header.js';

export default async function help() {
	await printHeader();
	log.message(`Manage Renovate update PRs on GitHub from the command line.`);
	log.message([
		`Usage:`,
		`  ${info(`${fmt.bold('runovate')} [options]`)}  Run the interactive CLI`,
		`  ${info.bold('runovate help')}       Show this help message`,
		`  ${info.bold('runovate version')}    Show the version of Runovate`,
	]);
	log.message([
		`Options:`,
		`  ${info(`${fmt.bold('--org')} <org>`)}         The GitHub username or organisation to fetch PRs from`,
		`  ${info(`${fmt.bold('--include_private')}`)}   Include private repositories`,
		`  ${info(`${fmt.bold('--max_prs')} <number>`)}  Maximum number of PRs to fetch`,
		`  ${info(`${fmt.bold('--client_id')} <id>`)}    A custom GitHub OAuth app client ID`,
	]);
	outro();
}
