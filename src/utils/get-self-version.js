export async function getSelfVersion() {
	return await import('../../package.json', { with: { type: 'json' } })
		.then(({ default: pkg }) => pkg.version)
		.catch(() => 'unknown');
}
