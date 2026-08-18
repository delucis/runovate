import { getSelfVersion } from './get-self-version.js';

/**
 * @param {string} endpoint
 * @param {RequestInit} [init]
 */
async function githubFetch(endpoint, init) {
	const url = new URL(`https://api.github.com${endpoint}`);
	if (endpoint !== '/graphql') {
		url.searchParams.set('per_page', '100'); // Fetch up to 100 items per page
	}
	const response = await fetch(url, init);

	if (!response.ok) {
		console.error(await response.text());
		throw new Error(`GitHub API request failed with status ${response.status}`);
	}

	return response.json();
}

/**
 * Create a basic GitHub client with the provided access token.
 * @param {string} accessToken GitHub access token
 */
export function GitHubClient(accessToken) {
	return {
		/**
		 * Use the GitHub REST API to fetch data from the specified endpoint.
		 * @param {string} endpoint The endpoint to fetch data from, e.g. `"/user"`
		 * @param {Record<string, any>} [body] Optional body to submit with the request.
		 */
		get: async (endpoint, body) =>
			githubFetch(endpoint, {
				body: JSON.stringify(body),
				headers: {
					Accept: 'application/vnd.github.v3+json',
					'X-GitHub-Api-Version': '2026-03-10',
					'User-Agent': `runovate/${await getSelfVersion()}`,
					Authorization: `token ${accessToken}`,
				},
			}),

		/**
		 * Use the GitHub GraphQL API to fetch data with the provided query and variables.
		 * @param {string} query A GraphQL query string.
		 * @param {Record<string, any>} [variables] Variables to pass to the GraphQL query.
		 * @returns
		 */
		query: async (query, variables) =>
			githubFetch('/graphql', {
				method: 'POST',
				body: JSON.stringify({ query, variables }),
				headers: {
					'User-Agent': `runovate/${await getSelfVersion()}`,
					Authorization: `token ${accessToken}`,
				},
			}),
	};
}
