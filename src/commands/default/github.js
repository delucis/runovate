import { spinner } from '@clack/prompts';
import { GitHubClient } from './github-client.js';

/**
 * @typedef {object} PR Type of a GitHub PR object returned by the `getPRs()` function.
 * @property {string} id
 * @property {number} number
 * @property {string} title
 * @property {string} permalink
 * @property {{ state: 'ERROR' | 'EXPECTED' | 'FAILURE' | 'PENDING' | 'SUCCESS' }} statusCheckRollup
 * @property {'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null} reviewDecision
 * @property {{ nodes: { state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' }[] }} latestOpinionatedReviews
 * @property {number} additions
 * @property {number} deletions
 * @property {number} changedFiles
 * @property {{ nodes: { path: string }[] }} files
 * @property {number} totalCommentsCount
 * @property {boolean} isReadByViewer
 * @property {'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN'} mergeable
 * @property {boolean} merged
 * @property {{ name: string; nameWithOwner: `${string}/${string}` }} repository
 */

/**
 * Search for open Renovate PRs in the given organization.
 * @param {string} org GitHub organisation or username e.g. `"delucis"` or `"withastro"`.
 * @param {ReturnType<typeof GitHubClient>} githubClient An authenticated GitHub client.
 * @param {number} max The maximum number of PRs to fetch.
 * @returns {Promise<Array<PR>>} An array of PR objects.
 */
export async function getPRs(org, githubClient, max) {
	const spin = spinner();
	spin.start(`Fetching open Renovate PRs for ${org}...`);

	const query = `query($max: Int!, $query: String!) {
    search(first: $max, query: $query, type: ISSUE) {
      nodes {
        ...on PullRequest {
          id,
          number,
          title,
          permalink,
          statusCheckRollup { state },
          reviewDecision,
          latestOpinionatedReviews(first: 10, writersOnly: true) { nodes { state } },
          additions,
          deletions,
          changedFiles,
          files(first: 5) { nodes { path } },
          totalCommentsCount,
          isReadByViewer,
          mergeable,
          merged,
          repository { name, nameWithOwner }
        }
      }
    }
  }`;

	const variables = {
		query: `type:pr author:renovate[bot] state:open org:${org}`,
		max,
	};

	const result = await githubClient.query(query, variables);

	spin.clear();

	return result.data.search.nodes;
}

/**
 * Normalize GitHub’s somewhat idiosyncratic review decision data to something more useful.
 *
 * In repositories where PR reviews are required, the `reviewDecision` field is accurate. However,
 * if reviews are not enforced, the `reviewDecision` field is always `null`, even if there are
 * reviews. In that case, we infer the review decision from the latest opinionated reviews.
 * (`getPRs()` fetches reviews only from authors with write access so this is a reasonable
 * heuristic.)
 * @param {PR} pr
 */
export function reviewDecision({ reviewDecision, latestOpinionatedReviews }) {
	if (reviewDecision) return reviewDecision;
	/** @type {NonNullable<PR['reviewDecision']>} */
	let decision = 'REVIEW_REQUIRED';
	for (const { state } of latestOpinionatedReviews.nodes) {
		if (state === 'CHANGES_REQUESTED') {
			decision = 'CHANGES_REQUESTED';
			break;
		} else if (state === 'APPROVED') {
			decision = 'APPROVED';
		}
	}
	return decision;
}

/**
 * Approve a PR using the GitHub GraphQL API.
 * @param {string} prId The ID of the PR to approve (from the PR’s `id` field).
 * @param {ReturnType<typeof GitHubClient>} githubClient An authenticated GitHub client.
 * @returns {Promise<void>}
 */
export async function approvePR(prId, githubClient) {
	const query = `mutation($prId: ID!) {
    addPullRequestReview(input: { pullRequestId: $prId, event: APPROVE }) {
      pullRequestReview {
        id
        state
      }
    }
  }`;
	await githubClient.query(query, { prId });
}

/**
 * Merge a PR using the GitHub GraphQL API.
 * @param {string} prId The ID of the PR to merge (from the PR’s `id` field).
 * @param {ReturnType<typeof GitHubClient>} githubClient An authenticated GitHub client.
 * @returns {Promise<{ pullRequest: { id: string; merged: boolean } } | "(intermediate value)">}
 */
export async function mergePR(prId, githubClient) {
	const query = `mutation($prId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    mergePullRequest(input: { pullRequestId: $prId, mergeMethod: $mergeMethod }) {
      pullRequest {
        id
        merged
      }
    }
  }`;

	const variables = {
		prId,
		// TODO: consider making the merge method configurable in case people have other preferences.
		mergeMethod: 'SQUASH', // or 'MERGE' or 'REBASE' depending on your preference
	};

	const result = await githubClient.query(query, variables);

	// Sometimes instead of an object, this can be the string "(intermediate value)". This is appears to be a bug in the GitHub API.
	return result.data.mergePullRequest;
}
