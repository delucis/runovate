/**
 * @param command {string} - The command to run, e.g. `"help"`, `"version"`, etc.
 * @returns {Promise<void>}
 */
export async function runCommand(command) {
	await import(`../commands/${command}.js`).then((mod) => mod.default());
}
