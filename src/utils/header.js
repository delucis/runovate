import { intro } from '@clack/prompts';
import fmt from 'femtocolors';
import { getSelfVersion } from './get-self-version.js';

export async function printHeader() {
	intro(fmt.inverse(` Runovate v${await getSelfVersion()} `));
}
