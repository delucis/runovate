import { settings } from '@clack/core';

const vimKeys = /** @type {const} */ ([
	['k', 'up'],
	['j', 'down'],
	['h', 'left'],
	['l', 'right'],
]);

/**
 * Disable the Vim keybindings Clack provides by default. This is useful for text input.
 */
export function disableVimKeys() {
	for (const [key] of vimKeys) {
		settings.aliases.delete(key);
	}
}

/**
 * Re-enable the Vim keybindings Clack provides by default if you disabled them.
 */
export function enableVimKeys() {
	for (const [key, action] of vimKeys) {
		settings.aliases.set(key, action);
	}
}
