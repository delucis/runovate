import { cancel, confirm, isCancel, log, note, progress, text } from '@clack/prompts';
import fmt from 'femtocolors';
import open from 'tiny-open';
import { customMultiselect } from '../prompts/custom-multiselect.js';
import { disableVimKeys, enableVimKeys } from '../utils/clack.js';
import { error, info, success } from '../utils/colors.js';
import { printHeader } from '../utils/header.js';
import { strictParse } from '../utils/strict-parse.js';
import { authenticateWithGitHub } from './default/github-auth.js';
import { GitHubClient } from './default/github-client.js';
import { approvePR, getPRs, mergePR, reviewDecision } from './default/github.js';
import {
	defaultInstructions,
	filterModeInstructions,
	header,
	optionRow,
	row,
} from './default/ui.js';

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

/**
 * Main interaction loop for the PR management UI.
 *
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

	/** @type {'DEFAULT' | 'FILTER'} */
	let mode = 'DEFAULT';
	let filterString = '';

	let headerString = header(0, PRs.length, mode, filterString);
	let instructions = defaultInstructions;

	/** @type {Array<import('@clack/prompts').Option<import('./default/github.js').PR> & { group: string | boolean }>} */
	let fullOptions;

	const selection = await customMultiselect({
		// Using a getter to let us modify values on rerender.
		get message() {
			return headerString;
		},
		get instructions() {
			return instructions;
		},

		options: PRs.reduce((acc, pr) => {
			const repo = fmt.bold(pr.repository.name);
			acc[repo] ??= [];
			acc[repo].push({ value: pr, label: optionRow(pr, filterString) });
			return acc;
		}, /** @type {import('@clack/prompts').GroupMultiSelectOptions<typeof PRs[number]>['options']} */ ({})),

		groupSpacing: 1,

		shortcuts: [
			{
				label: 'a',
				hint: 'select approved',
				handle({ key, prompt }) {
					if (mode !== 'DEFAULT') return;
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
					if ((mode === 'DEFAULT' && key === 'x') || key === 'X') {
						prompt.value = [];
					}
				},
			},
			{
				label: 'o',
				hint: 'open current',
				handle({ key, prompt }) {
					if ((mode === 'DEFAULT' && key === 'o') || key === 'O') {
						const currentOption = prompt.options[prompt.cursor];
						if (currentOption && currentOption.group !== true) {
							open(currentOption.value.permalink);
							currentOption.value.isReadByViewer = true;
							currentOption.label = optionRow(currentOption.value, filterString);
						}
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
							currentOption.label = optionRow(currentOption.value, filterString);
							rerender();
						} catch (error) {
							currentOption.label = optionRow(currentOption.value, filterString);
							rerender();
						}
					}
				},
			},
			{
				label: 'r',
				hint: 'refresh',
				handle({ key, prompt }) {
					if (mode !== 'DEFAULT') return;
					if (key !== 'r') return;
					prompt.state = 'submit';
				},
			},
			{
				label: '^f',
				hint: 'toggle filter',
				handle({ key, info, prompt }) {
					if (!key) return;
					if (key === '\x06' || (info.name === 'f' && info.ctrl)) {
						// On ^f toggle between filter and default mode.
						if (mode === 'DEFAULT') {
							mode = 'FILTER';
							fullOptions = prompt.options;
							instructions = filterModeInstructions;
							disableVimKeys();
						} else {
							mode = 'DEFAULT';
							prompt.options = fullOptions;
							instructions = defaultInstructions;
							enableVimKeys();
						}
						filterString = '';
						return;
					}
					if (mode === 'DEFAULT') {
						return;
					}
					// Handle user input, supports backspace, alphanumeric characters, spaces, slashes, parentheses, colons, at signs, and hyphens.
					if (key === '\x7f' || info.name === 'backspace') {
						filterString = filterString.slice(0, -1);
					} else if (/^[a-z0-9\/():@^-]$/.test(key)) {
						filterString += key;
					}
					// Update options to only display PRs matching the current search string.
					const filter = filterString.toLowerCase();
					prompt.options = fullOptions.filter((option, _idx, options) => {
						if (option.group === true) {
							return options.some(
								(childOption) =>
									childOption.group === option.label &&
									childOption.value.title.toLowerCase().includes(filter),
							);
						}
						const matches = option.value.title.toLowerCase().includes(filter);
						if (matches) {
							option.label = optionRow(option.value, filterString);
						}
						return matches;
					});
					prompt.value = prompt.value?.filter((pr) => pr.title.toLowerCase().includes(filter));
				},
			},
		],

		beforeRender({ prompt }) {
			switch (prompt.state) {
				case 'submit': {
					// Update labels and header on submit so the final output is compact and easier to read.
					prompt.options.forEach((option) => {
						if (option.group === true) return;
						option.label = `${option.value.repository.nameWithOwner}#${option.value.number}`;
					});
					headerString = prompt.value?.length
						? success.inverse(
								` ${prompt.value?.length} PR${prompt.value?.length === 1 ? '' : 's'} selected `,
							)
						: '';
					return;
				}
			}

			// Rerender header and options.
			headerString = header(prompt.value?.length || 0, PRs.length, mode, filterString);
			prompt.options.forEach((option) => {
				if (option.group === true) return;
				option.label = optionRow(option.value, filterString);
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
			let merged = 0;
			bar.start(`Merging ${index}/${selection.length} PRs...`);
			for (const { id, repository, number } of selection) {
				const result = await mergePR(id, githubClient);
				if (result.pullRequest?.merged) {
					store.mergedPRs.add(id);
					merged++;
				} else if (result.errors) {
					log.error(
						error(`Failed to merge PR ${fmt.bold(`${repository.nameWithOwner}#${number}`)}\n`) +
							`${result.errors.map((e) => error(`${e.type}: ${e.message}`)).join('\n')}`,
					);
				}
				index++;
				bar.advance(1, `Merging ${index}/${selection.length} PRs...`);
			}
			bar.stop(`Merged ${merged} PR${merged === 1 ? '' : 's'}`);
		}
	}
}

/**
 * Main entry point for the `runovate` command.
 * Authenticates with GitHub, then runs the main TUI interaction loop.
 */
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
