/*!
 * Derived from node-keychain
 *
 * MIT License
 * Copyright(c) 2023 Nicholas Penree <nick@penree.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the " Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice (including the next paragraph) shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { spawn } from 'node:child_process';

/**
 * A very simplified interface to the macOS Keychain that supports basic get/set/delete operations.
 */
class Keychain {
	#executablePath = '/usr/bin/security';

	/**
	 * Check if the keychain is supported on this platform.
	 *
	 * @example
	 * if (keychain.isSupported) {
	 *   // Keychain is supported, proceed with keychain operations
	 * } else {
	 *   // Keychain is not supported, handle accordingly
	 * }
	 *
	 * @returns {boolean} True if the keychain is supported, false otherwise.
	 */
	get isSupported() {
		return process.platform === 'darwin';
	}

	/**
	 * Retrieve a password from the keychain.
	 *
	 * @param {string} account
	 * @param {string} service
	 * @param {'generic' | 'internet'} [type]
	 *
	 * @returns {Promise<string | null>} The retrieved password, or null if not found.
	 */
	get(account, service, type = 'generic') {
		const { promise, resolve } = /** @type {PromiseWithResolvers<string | null>} */ (
			Promise.withResolvers()
		);

		const security = spawn(this.#executablePath, [
			'find-' + type + '-password',
			'-a',
			account,
			'-s',
			service,
			'-g',
		]);

		let password = '';

		// For better or worse, the last line (containing the actual password) is actually written to stderr instead of stdout.
		// Reference: http://blog.macromates.com/2006/keychain-access-from-shell/
		security.stderr.on('data', (d) => {
			password += String(d);
		});

		security.on('close', (code) => {
			if (code === 0) {
				// When keychain escapes a char into octal it also includes a hex
				// encoded version.
				//
				// e.g. password 'passWith\' becomes:
				// password: 0x70617373576974685C  "passWith\134"
				//
				// And if the password does not contain ASCII it leaves out the quoted
				// version altogether:
				//
				// e.g. password '∆˚ˆ©ƒ®∂çµ˚¬˙ƒ®†¥' becomes:
				// password: 0xE28886CB9ACB86C2A9C692C2AEE28882C3A7C2B5CB9AC2ACCB99C692C2AEE280A0C2A5
				const hexPassword = password.match(/^password: 0x([0-9a-fA-F]+)/)?.[1];
				if (hexPassword) {
					return resolve(Buffer.from(hexPassword, 'hex').toString());
				}

				// Otherwise the password will be in quotes:
				// password: "passWithoutSlash"
				const plainTextPassword = password.match(/^password: "(.*)\"/)?.[1];
				if (plainTextPassword) {
					return resolve(plainTextPassword);
				}
			}

			// If we reach this point, it means we couldn't parse the password.
			return resolve(null);
		});

		return promise;
	}

	/**
	 * Set/update a password in the keychain.
	 *
	 * @param {string} account
	 * @param {string} service
	 * @param {string} password
	 * @param {'generic' | 'internet'} [type]
	 *
	 * @returns {Promise<void>} Resolves when the password is set successfully.
	 */
	set(account, service, password, type = 'generic') {
		const { promise, resolve, reject } = /** @type {PromiseWithResolvers<void>} */ (
			Promise.withResolvers()
		);

		const security = spawn(this.#executablePath, [
			'add-' + type + '-password',
			'-a',
			account,
			'-s',
			service,
			'-w',
			password,
		]);

		security.on('error', reject);

		security.on('close', (code) => {
			if (code == 45) {
				// Code 45 indicates that the item already exists in the keychain.
				// Delete the existing password and try again.
				this.delete(account, service, type)
					.then(() => this.set(account, service, password, type).then(resolve).catch(reject))
					.catch(reject);
			} else if (code !== 0) {
				return reject(`Security returned a non-successful error code: ${code}`);
			} else {
				resolve();
			}
		});

		return promise;
	}

	/**
	 * Delete a password from the keychain.
	 *
	 * @param {string} account
	 * @param {string} service
	 * @param {'generic' | 'internet'} [type]
	 *
	 * @returns {Promise<void>} Resolves when the password is deleted successfully.
	 */
	delete(account, service, type = 'generic') {
		const { promise, resolve, reject } = /** @type {PromiseWithResolvers<void>} */ (
			Promise.withResolvers()
		);

		const security = spawn(this.#executablePath, [
			'delete-' + type + '-password',
			'-a',
			account,
			'-s',
			service,
		]);

		security.on('error', reject);

		security.on('close', (code) => {
			if (code !== 0) {
				return reject(new Error('Could not find password'));
			}
			resolve();
		});

		return promise;
	}
}

export const keychain = new Keychain();
