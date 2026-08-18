import { outro } from '@clack/prompts';
import { printHeader } from '../utils/header.js';
import { keychain } from '../utils/macos-keychain.js';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from '../utils/constants.js';

export default async function logout() {
	await printHeader();
	if (keychain.isSupported) {
		await keychain.delete(KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE);
	}
	outro('Logged out of GitHub');
}
