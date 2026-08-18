import { getColumns } from '@clack/core';
import { cancel, confirm, isCancel, log, note, progress, spinner, text } from '@clack/prompts';
import fastStringWidth from 'fast-string-width';
import fmt from 'femtocolors';
import open from 'open';
import { customMultiselect } from '../prompts/custom-multiselect.js';
import { error, info, success, warning } from '../utils/colors.js';
import { authenticateWithGitHub } from '../utils/github-auth.js';
import { GitHubClient } from '../utils/github.js';
import { printHeader } from '../utils/header.js';
import { strictParse } from '../utils/strict-parse.js';

/** Parse CLI options for this command. */
function getArgs() {
	return strictParse(process.argv, {
		default: {
			client_id: 'Ov23lit7H6Mnl5CN9B5N',
			include_private: false,
		},
		string: ['org', 'client_id', 'max_prs'],
		boolean: ['include_private'],
	});
}

const labels = {
	reviewDecision: {
		header: fmt.underline('Reviews'),
		APPROVED: success('[ ✔ ]') + '  ',
		CHANGES_REQUESTED: error('[ ✖ ]') + '  ',
		REVIEW_REQUIRED: fmt.gray('[ - ]') + '  ',
	},
	checkState: {
		header: fmt.underline('Checks'),
		ERROR: error('[ ✖ ]') + ' ',
		EXPECTED: warning('[ ◓ ]') + ' ',
		FAILURE: error('[ ✖ ]') + ' ',
		PENDING: warning('[ ◓ ]') + ' ',
		SUCCESS: success('[ ✔ ]') + ' ',
	},
	changeDetails: {
		header: '  ' + fmt.underline('Changes') + '         ',
	},
	files: {
		header: fmt.underline('Files'),
	},
};

/**
 * @param {string[]} strings
 */
const widestWidth = (strings) => Math.max(...strings.map((label) => fastStringWidth(label)));

const colWidth = {
	reviewDecision: widestWidth(Object.values(labels.reviewDecision)),
	checkState: widestWidth(Object.values(labels.checkState)),
	changeDetails: 18,
};

/** Formatter for compact representations of quantities, e.g. `2.1M` or `17k`. */
const shortNum = new Intl.NumberFormat('en', { notation: 'compact' }).format;

/**
 * @param {object} context
 * @param {string} context.org
 * @param {ReturnType<typeof GitHubClient>} context.githubClient
 * @param {ReturnType<typeof getArgs>} context.args
 * @param {{ mergedPRs: Set<string> }} context.store
 * @returns {Promise<void>}
 */
async function loop({ org, githubClient, args, store }) {
	let PRs = await getPRs(org, githubClient, args.max_prs ? parseInt(args.max_prs, 10) : 100);
	// Sometimes the search API returns cached PR state for recently merged PRs, so we manually
	// filter these out based on our tracking during a session.
	PRs = PRs.filter((pr) => !store.mergedPRs.has(pr.id));

	let columns = getColumns(process.stdout);

	/**
	 * @param {string} status One-character status indicator e.g. `fmt.blue('●')`
	 * @param {string} title
	 * @param {string} checkState
	 * @param {string} reviewDecision
	 * @param {string | { changedFiles: number; additions: number; deletions: number } | null} pr
	 * @param {string | string[] | null} files
	 */
	const row = (status, title, checkState, reviewDecision, pr, files) => {
		const screenWidth = columns - 20;
		const maxWidth = Math.min(screenWidth, 125);
		const selectUIWidth = 20;
		const paddingWidth = 4;
		const padding = ' '.repeat(paddingWidth);
		const statusIndicator = status || ' ';
		const availableTitleWidth =
			maxWidth -
			selectUIWidth -
			2 - // status indicator
			paddingWidth * 3 -
			colWidth.checkState -
			colWidth.reviewDecision -
			colWidth.changeDetails;
		const minTitleWidth = 36;
		const titleWidth = Math.max(availableTitleWidth, minTitleWidth);
		if (title.length > titleWidth) {
			title = title.slice(0, titleWidth - 1).trim() + '…';
		}
		if (title.length < titleWidth) {
			title = title.padEnd(titleWidth);
		}

		let line = statusIndicator + ' ' + title;

		if (fastStringWidth(line) + paddingWidth + colWidth.checkState < maxWidth) {
			line += padding + checkState;
		} else {
			return line;
		}

		if (fastStringWidth(line) + paddingWidth + colWidth.reviewDecision < maxWidth) {
			line += padding + reviewDecision;
		} else {
			return line;
		}

		if (fastStringWidth(line) + paddingWidth + colWidth.changeDetails < maxWidth) {
			// 100 files +10k-10k
			//  10 files  +1k-1k
			//   1 file  +100-100
			//   2 files   +7-18
			// -3-|--5--|---8----
			const changeDetails = pr
				? typeof pr === 'string'
					? pr
					: [
							fmt.gray(shortNum(pr.changedFiles).padStart(3)),
							fmt.gray(`file${pr.changedFiles === 1 ? ' ' : 's'}`),
							fmt.green(`+${shortNum(pr.additions)}`.padStart(4)) +
								fmt.red(`-${shortNum(pr.deletions)}`.padEnd(4)),
						].join(' ')
				: '';
			line += padding + changeDetails.padEnd(colWidth.changeDetails);
		} else {
			return line;
		}

		if (fastStringWidth(line) + paddingWidth + 5 < screenWidth) {
			if (typeof files === 'string') {
				line += padding + files;
			} else if (pr && typeof pr !== 'string' && files) {
				const fileSeparator = ', ';
				const availableWidth = screenWidth - fastStringWidth(line) - paddingWidth;
				const filesToShow = [];
				let usedWidth = 0;
				for (const file of files) {
					const fileWidth = fastStringWidth(file + fileSeparator);
					if (usedWidth + fileWidth <= availableWidth) {
						filesToShow.push(file);
						usedWidth += fileWidth;
					} else {
						break;
					}
				}
				if (filesToShow.length > 0) {
					line += padding + fmt.gray(filesToShow.join(fileSeparator));
					if (filesToShow.length < pr.changedFiles) {
						line += fmt.gray(', ...');
					}
				} else {
					line += padding + fmt.gray('...');
				}
			}
		}

		return line;
	};

	/** @param {PR} pr */
	const optionRow = (pr) => {
		return row(
			pr.mergeable === 'CONFLICTING' ? error.bold('‼︎') : pr.isReadByViewer ? ' ' : fmt.blue('●'),
			pr.title,
			labels.checkState[pr.statusCheckRollup.state],
			labels.reviewDecision[reviewDecision(pr)],
			pr,
			pr.files.nodes.map((file) => file.path),
		);
	};

	/**
	 * @param {number} selectedCount
	 */
	const header = (selectedCount) => {
		return [
			fmt.inverse(` Found ${PRs.length} Renovate PR${PRs.length === 1 ? '' : 's'} `) +
				fmt.dim(` Use shortcuts to select, approve, and merge`),
			'    ' +
				row(
					'',
					`└─ ${selectedCount} selected ─┘`,
					labels.checkState.header,
					labels.reviewDecision.header,
					labels.changeDetails.header,
					labels.files.header,
				),
		].join(`\n${fmt.cyan('│')}  `);
	};

	let headerString = header(0);

	const selection = await customMultiselect({
		get message() {
			return headerString;
		},

		options: PRs.reduce((acc, pr) => {
			const repo = fmt.bold(pr.repository.name);
			acc[repo] ??= [];
			acc[repo].push({
				value: pr,
				label: optionRow(pr),
				// label: [
				// 	pr.isReadByViewer ? ' ' : fmt.blue('●'),
				// 	`${pr.statusCheckRollup.state === 'SUCCESS' ? success.bold('✔') : pr.statusCheckRollup.state === 'FAILURE' || pr.statusCheckRollup.state === 'ERROR' ? error.bold('✖') : warning.bold('◓')}`,
				// 	`${pr.reviewDecision === 'APPROVED' ? success.bold('✔') : pr.reviewDecision === 'CHANGES_REQUESTED' ? error.bold('✖') : warning.bold('◓')}`,
				// 	pr.mergeable === 'CONFLICTING' ? error('CONFLICTED') : '',
				// 	`${pr.title}`,
				// ].join(' '),
				// hint: `${pr.changedFiles} file${pr.changedFiles > 1 ? 's' : ''} ${fmt.green(`+${pr.additions}`)}${fmt.red(`-${pr.deletions}`)}`,
			});
			return acc;
		}, /** @type {import('@clack/prompts').GroupMultiSelectOptions<typeof PRs[number]>['options']} */ ({})),

		groupSpacing: 1,

		shortcuts: [
			{
				label: 'a',
				hint: 'select approved',
				handle({ key, prompt }) {
					if (key !== 'a') return;
					prompt.value = prompt.options
						.filter(
							(option) => option.group !== true && reviewDecision(option.value) === 'APPROVED',
						)
						.map((option) => option.value);
				},
			},
			{
				label: 'A',
				hint: 'select all',
				handle({ key, prompt }) {
					if (key !== 'A') return;
					prompt.value = prompt.options
						.filter((option) => option.group !== true)
						.map((option) => option.value);
				},
			},
			{
				label: 'x',
				hint: 'clear selection',
				handle({ key, prompt }) {
					if (key !== 'x') return;
					prompt.value = [];
				},
			},
			{
				label: 'o',
				hint: 'open current',
				handle({ key, prompt }) {
					if (key !== 'o') return;
					const currentOption = prompt.options[prompt.cursor];
					if (currentOption && currentOption.group !== true) {
						open(currentOption.value.permalink);
						currentOption.value.isReadByViewer = true;
						currentOption.label = optionRow(currentOption.value);
					}
				},
			},
			{
				label: '+',
				hint: 'approve current',
				async handle({ key, prompt, rerender }) {
					if (key !== '+') return;
					const currentOption = prompt.options[prompt.cursor];
					if (currentOption && currentOption.group !== true) {
						currentOption.label = row(
							' ',
							`Approving #${currentOption.value.number}...`,
							'..... ',
							'.....  ',
							currentOption.value,
							currentOption.value.files.nodes.map((file) => file.path),
						);
						try {
							await approvePR(currentOption.value.id, githubClient);
							currentOption.value.reviewDecision = 'APPROVED';
							currentOption.label = optionRow(currentOption.value);
							rerender();
						} catch (error) {
							currentOption.label = optionRow(currentOption.value);
							rerender();
						}
					}
				},
			},
			{
				label: 'enter',
				hint: 'merge selected',
				handle() {},
			},
			{
				label: 'q',
				hint: 'quit',
				handle({ key }) {
					if (key !== 'q') return;
					process.exit(0);
				},
			},
		],

		beforeRender({ prompt }) {
			headerString = header(prompt.value?.length || 0);

			if (prompt.state === 'submit') {
				// Update labels and header on submit so the final output is compact and easier to read.
				prompt.options.forEach((option) => {
					if (option.group === true) return;
					option.label = `${option.value.repository.nameWithOwner}#${option.value.number}`;
				});
				headerString = success.inverse(
					` ${prompt.value?.length} PR${prompt.value?.length === 1 ? '' : 's'} selected `,
				);
				return;
			}

			const newColumns = getColumns(process.stdout);
			if (newColumns === columns) return;
			columns = newColumns;
			headerString = header(prompt.value?.length || 0);
			prompt.options.forEach((option) => {
				if (option.group === true) return;
				option.label = optionRow(option.value);
			});
		},
	});

	if (isCancel(selection)) {
		cancel('Canceled.');
		process.exit(1);
	}

	if (selection && selection.length > 0) {
		note(
			selection
				.map((pr) => `${fmt.dim(`- ${org}/`)}${pr.repository.name}#${pr.number} ${info(pr.title)}`)
				.join('\n'),
			fmt.bold('The following PRs will be merged:'),
		);
		const shouldMerge = await confirm({
			message: fmt.bold(
				`Merge ${selection.length} selected PR${selection.length === 1 ? '' : 's'}?`,
			),
		});
		if (isCancel(shouldMerge)) {
			cancel('Canceled.');
			process.exit(1);
		}

		if (shouldMerge) {
			const bar = progress({
				style: 'block',
				max: selection.length,
			});
			let index = 1;
			bar.start(`Merging ${index}/${selection.length} PRs...`);
			for (const { id } of selection) {
				const { pullRequest } = await mergePR(id, githubClient);
				if (pullRequest.merged) {
					store.mergedPRs.add(id);
				}
				index++;
				bar.advance(1, `Merging ${index}/${selection.length} PRs...`);
			}
			bar.stop(`Merged ${selection.length} PR${selection.length === 1 ? '' : 's'}`);
		}
	}
}

export default async function main() {
	await printHeader();

	const args = getArgs();

	// Authenticate with GitHub, prompting user when necessary.
	const accessToken = await authenticateWithGitHub(args);
	const githubClient = GitHubClient(accessToken);
	const user = await githubClient.get('/user');
	log.info(`Authenticated as ${info.bold(user.login)}`);

	// If args.org is undefined, prompt the user to enter one.
	const org = args.org || (await getOrg(user.login));

	// Display open Renovate PRs in a user-friendly format including a quick view  of review status and CI checks
	const store = { mergedPRs: /** @type {Set<string>} */ (new Set()) };
	while (true) {
		await loop({ org, githubClient, args, store });
	}
}

/**
 * Prompt the user to enter their GitHub username or organization name.
 * @param {string} initialValue A suggested value
 */
async function getOrg(initialValue) {
	const org = await text({
		message: fmt.bold('What GitHub username or org do you want to fetch PRs from?'),
		initialValue,
		validate: (value) => {
			if (!value) {
				return 'Please enter a valid GitHub username or organization name.';
			}
		},
	});

	if (!org || isCancel(org)) {
		cancel('Canceled.');
		process.exit(1);
	}

	return org;
}

/**
 * @typedef {object} PR
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
 * @param {string} org
 * @param {ReturnType<typeof GitHubClient>} githubClient
 * @param {number} max
 * @returns {Promise<Array<PR>>}
 */
async function getPRs(org, githubClient, max) {
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

	const PRs = result.data.search.nodes;

	spin.clear();

	return PRs;
}

/** @param {PR} pr */
function reviewDecision({ reviewDecision, latestOpinionatedReviews }) {
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
 * @param {string} prId
 * @param {ReturnType<typeof GitHubClient>} githubClient
 * @returns {Promise<{ pullRequestReview: { id: string; state: string } }>}
 */
async function approvePR(prId, githubClient) {
	const query = `mutation($prId: ID!) {
    addPullRequestReview(input: { pullRequestId: $prId, event: APPROVE }) {
      pullRequestReview {
        id
        state
      }
    }
  }`;

	const variables = {
		prId,
	};

	return await githubClient.query(query, variables);
}

/**
 *
 * @param {string} prId
 * @param {ReturnType<typeof GitHubClient>} githubClient
 * @returns {Promise<{ pullRequest: { id: string; merged: boolean } }>}
 */
async function mergePR(prId, githubClient) {
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
		mergeMethod: 'SQUASH', // or 'MERGE' or 'REBASE' depending on your preference
	};

	const result = await githubClient.query(query, variables);

	return result.data.mergePullRequest;
}
