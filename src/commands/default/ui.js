import { getColumns } from '@clack/core';
import { S_BAR } from '@clack/prompts';
import { sliceAnsi } from 'fast-slice-ansi';
import fastStringWidth from 'fast-string-width';
import fmt from 'femtocolors';
import { error, success, warning } from '../../utils/colors.js';
import { reviewDecision } from './github.js';

/**
 * UI labels for the various PR states and metrics.
 */
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
		header: ' ' + fmt.underline('Changes'),
	},
	files: {
		header: fmt.underline('Files'),
	},
};

/**
 * Get the widest string width from an array of potentially ANSI-formatted strings.
 * @param {string[]} strings
 */
const widestWidth = (strings) => Math.max(...strings.map((label) => fastStringWidth(label)));

/**
 * Fixed column widths for the different PR metric columns in the UI.
 */
const colWidth = {
	/** Start-of-line space for the selection UI: "│  └ ◻ " */
	selectUI: 7,
	reviewDecision: widestWidth(Object.values(labels.reviewDecision)),
	checkState: widestWidth(Object.values(labels.checkState)),
	changeDetails: fastStringWidth(labels.changeDetails.header),
	statusIndicator: 2, // Just one char + one space.
	minimumFilesColumnWidth: 7, // "(3) " + "..." = 7 chars
};

/** Formatter for compact representations of quantities, e.g. `2.1M` or `17k`. */
const shortNum = new Intl.NumberFormat('en', { notation: 'compact' }).format;

/**
 * Format a single row of the PR selection list in the UI.
 *
 * Outputs an ANSI-styled string like:
 * ```
 * ● Title of the PR Renovate created    [ ✔ ]     [ - ]      +10k-10k     (3) file1, file2, file3...
 * ```
 *
 * Adapts to the available window size to render more or less information.
 *
 * @param {string} status One-character status indicator e.g. `fmt.blue('●')`
 * @param {string} title The PR’s title.
 * @param {string} checkState The PR’s check state.
 * @param {string} reviewDecision The PR’s review decision.
 * @param {string | { changedFiles: number; additions: number; deletions: number } | null} changes Details about changes to the PR (or just a string to set directly).
 * @param {string | string[] | null} files List of files altered by the PR (or just a string to set directly).
 */
export function row(status, title, checkState, reviewDecision, changes, files) {
	// It seems sometimes the terminal is slightly narrower than reported so we narrow the target width to leave a buffer.
	const screenWidth = getColumns(process.stdout) - colWidth.selectUI - 10;
	/** Spacing width between columns. */
	const paddingWidth = Math.max(Math.round(screenWidth * 0.02), 1);
	/** Spacing string to add between columns when building the row. */
	const padding = ' '.repeat(paddingWidth);
	/** How much space is available for the title to use. */
	const availableTitleWidth =
		screenWidth -
		colWidth.statusIndicator -
		paddingWidth * 4 -
		colWidth.checkState -
		colWidth.reviewDecision -
		colWidth.changeDetails -
		colWidth.minimumFilesColumnWidth;

	// Constrain the title width to avoid truncating too much or having an overly wide column.
	const minTitleWidth = 30;
	const maxTitleWidth = 55;
	const titleWidth = Math.max(Math.min(availableTitleWidth, maxTitleWidth), minTitleWidth);

	if (fastStringWidth(title) > titleWidth) {
		// Truncate the title if it is too wide.
		title = sliceAnsi(title, 0, titleWidth - 1).trim() + '…';
	}
	if (fastStringWidth(title) < titleWidth) {
		// Pad the title if it is too narrow.
		title = title + ' '.repeat(titleWidth - fastStringWidth(title));
	}

	/** The row output string. */
	let line = (status || ' ') + ' ' + title;

	// Checks column
	if (fastStringWidth(line) + paddingWidth + colWidth.checkState < screenWidth) {
		line += padding + checkState;
	} else {
		return line;
	}

	// Reviews column
	if (fastStringWidth(line) + paddingWidth + colWidth.reviewDecision < screenWidth) {
		line += padding + reviewDecision;
	} else {
		return line;
	}

	// Changes column, e.g.
	// +10k-10k
	//  +1k-1k
	// +100-100
	//   +7-18
	if (fastStringWidth(line) + paddingWidth + colWidth.changeDetails < screenWidth) {
		const changeDetails = changes
			? typeof changes === 'string'
				? changes
				: fmt.green(`+${shortNum(changes.additions)}`.padStart(4)) +
					fmt.red(`-${shortNum(changes.deletions)}`.padEnd(4))
			: '';
		line += padding + changeDetails.padEnd(colWidth.changeDetails);
	} else {
		return line;
	}

	// Files column
	if (fastStringWidth(line) + paddingWidth + 5 < screenWidth) {
		if (typeof files === 'string') {
			line += padding + files;
		} else if (changes && typeof changes !== 'string' && files) {
			const fileCountString = `(${changes.changedFiles}) `;
			const fileSeparator = ', ';
			const ellipsis = '...';
			const lineEnding = `, ${ellipsis}`;

			line += padding + fmt.gray(fileCountString);

			const availableWidth = Math.max(0, screenWidth - fastStringWidth(line) - lineEnding.length);

			let fileList = files.join(fileSeparator);
			if (fileList.length > availableWidth) {
				// Truncate to fit, adding an ellipsis to indicate the truncation.
				fileList = fileList.slice(0, availableWidth) + ellipsis;
			} else if (files.length < changes.changedFiles) {
				// If the file list we fetched is shorter than the total number of changed files, add an
				// ellipsis to indicate that there are more files.
				fileList += lineEnding;
			}

			line += fmt.gray(fileList);
		}
	}

	return line;
}

/**
 * Format a single row of the PR selection list from a PR object.
 * @param {import('./github').PR} pr A PR object from the GitHub API.
 * @param {string} filter The current filter string, if any.
 */
export const optionRow = (pr, filter) => {
	const title = filter
		? pr.title.replace(
				new RegExp(`(${filter.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'),
				fmt.magenta.bold.underline('$1'),
			)
		: pr.title;

	return row(
		pr.mergeable === 'CONFLICTING' ? error.bold('‼︎') : pr.isReadByViewer ? ' ' : fmt.blue('●'),
		title,
		labels.checkState[pr.statusCheckRollup.state],
		labels.reviewDecision[reviewDecision(pr)],
		pr,
		pr.files.nodes.map((file) => file.path),
	);
};

/**
 * Format the header rows of the PR selection UI.
 *
 * ```
 *  Found 15 Renovate PRs  Use shortcuts to select, approve, and merge
 * ╲▁▁▁  10 selected  ▁▁▁╱                                           Checks    Reviews     Changes    Files
 * ```
 *
 * @param {number} selectedCount The number of PRs currently selected.
 * @param {number} totalPRs The total number of PRs available for selection.
 * @param {'DEFAULT' | 'FILTER'} mode The current mode of the UI.
 * @param {string} filterString The current filter string, if any.
 * @returns {string} The formatted header string.
 */
export const header = (selectedCount, totalPRs, mode, filterString) => {
	return [
		// Top row
		[
			fmt.inverse(` Found ${totalPRs} Renovate PR${totalPRs === 1 ? ' ' : 's'} `),
			mode === 'FILTER'
				? fmt.magenta.inverse(' Filter: ') +
					fmt.magenta.underline.bold(' ' + (filterString + '█').padEnd(18) + '  ▕')
				: fmt.dim(`Use shortcuts to select, approve, and merge`),
		].join(' '),
		// Second row
		// Selection indicator
		'╲▁' +
			fmt.gray('▁' + fmt.dim('▁')) +
			row(
				'',
				(selectedCount ? success.bold : fmt.dim)(
					`${String(selectedCount).padStart(Math.floor(Math.log(totalPRs) / Math.LN10) + 1)} selected  `,
				) +
					fmt.gray(fmt.dim('▁') + '▁') +
					`▁╱`,
				// Column headers
				labels.checkState.header,
				labels.reviewDecision.header,
				labels.changeDetails.header,
				labels.files.header,
			),
	].join(`\n${fmt.cyan(S_BAR)}  `); // Joined using the vertical bar Clack uses to ensure it connects with the rest of the prompt UI.
};

export const defaultInstructions = [
	['↑/↓', 'to navigate'],
	['space', 'select current'],
	['a', 'select approved'],
	['A', 'select all'],
	['x', 'clear selection'],
	['o', 'open current'],
	['+', 'approve current'],
	['^f', 'filter'],
	['enter', 'merge selected'],
	['r', 'refresh'],
	['esc', 'quit'],
].map(([key, desc]) => `${fmt.white.bgGray(` ${key} `)} ${desc}`);

export const filterModeInstructions = [
	['↑/↓', 'to navigate'],
	['space', 'select current'],
	['A', 'select all'],
	['X', 'clear selection'],
	['O', 'open current'],
	['+', 'approve current'],
	['^f', 'exit filter'],
	['enter', 'merge selected'],
	['esc', 'quit'],
].map(([key, desc]) => fmt.magenta(`${fmt.inverse(` ${key} `)} ${desc}`));
