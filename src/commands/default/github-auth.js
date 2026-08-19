import { cancel, confirm, isCancel, note, spinner } from '@clack/prompts';
import fmt from 'femtocolors';
import open from 'tiny-open';
import { writeText } from 'tinyclip';
import { error, info } from '../../utils/colors.js';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from '../../utils/constants.js';
import { keychain } from '../../utils/macos-keychain.js';

/**
 * Authenticate the user with GitHub using the OAuth device flow.
 * @param {{ client_id: string; include_private: boolean}} options
 * @returns {Promise<string>} The user’s GitHub access token.
 */
export async function authenticateWithGitHub({ client_id, include_private }) {
	if (keychain.isSupported) {
		const spin = spinner();
		spin.start('Logging in to GitHub...');

		const refreshToken = await keychain.get(KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE);
		if (refreshToken) {
			const accessTokenURL = new URL('https://github.com/login/oauth/access_token');
			accessTokenURL.searchParams.set('client_id', client_id);
			accessTokenURL.searchParams.set('grant_type', 'refresh_token');
			accessTokenURL.searchParams.set('refresh_token', refreshToken);

			const { access_token, refresh_token: newRefreshToken } = await fetch(accessTokenURL, {
				method: 'POST',
				headers: { Accept: 'application/json' },
			}).then((res) => res.json());

			if (access_token) {
				try {
					await keychain.set(KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, newRefreshToken);
				} catch {}

				spin.clear();

				return access_token;
			}
		}

		spin.clear();
	}

	const codeURL = new URL('https://github.com/login/device/code');
	codeURL.searchParams.set('client_id', client_id);
	codeURL.searchParams.set('scope', include_private ? 'repo' : 'public_repo');
	const { device_code, user_code, verification_uri, interval } = await fetch(codeURL, {
		method: 'POST',
		headers: { Accept: 'application/json' },
	}).then((res) => res.json());

	note(
		'Open GitHub in your browser and enter the following code to authenticate:\n\n' +
			`Code: ${info.bold(user_code)}\n\n` +
			`${fmt.dim(verification_uri)}`,
		'Log in to GitHub',
	);

	const proceed = await confirm({
		message: fmt.bold('Press enter to copy the code and open your browser.'),
		active: 'Proceed',
		inactive: 'Skip',
	});
	if (isCancel(proceed)) {
		cancel('Canceled.');
		process.exit(1);
	}
	if (proceed) {
		await writeText(user_code);
		open(verification_uri + `?skip_account_picker=true&user_code=${user_code}`);
	}

	const spin = spinner();
	spin.start('Waiting for GitHub authentication...');

	const authHandle = Promise.withResolvers();

	const t = Date.now();
	const timeout = 5 * 60 * 1000; // 5 minutes
	const pollInterval = interval * 1000; // Use the minimum interval provided by GitHub

	const accessTokenURL = new URL(' https://github.com/login/oauth/access_token');
	accessTokenURL.searchParams.set('client_id', client_id);
	accessTokenURL.searchParams.set('device_code', device_code);
	accessTokenURL.searchParams.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

	const task = async () => {
		if (Date.now() - t > timeout) {
			authHandle.reject(new Error('GitHub authentication timed out.'));
		}
		const {
			access_token,
			refresh_token,
			error: authError,
		} = await fetch(accessTokenURL, {
			method: 'POST',
			headers: { Accept: 'application/json' },
		}).then((res) => res.json());

		if (access_token) {
			authHandle.resolve(access_token);
			try {
				if (keychain.isSupported) {
					await keychain.set(KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, refresh_token);
				}
			} catch {}
		} else if (authError && authError !== 'authorization_pending') {
			authHandle.reject(new Error(`GitHub authentication error: ${authError}`));
		} else {
			setTimeout(task, pollInterval);
		}
	};
	task();

	const accessToken = await authHandle.promise.catch((err) => {
		spin.error(error(err.message));
		cancel();
		process.exit(1);
	});

	spin.stop('GitHub authentication successful.');

	return accessToken;
}
