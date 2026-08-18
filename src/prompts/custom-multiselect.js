import { getColumns, GroupMultiSelectPrompt, settings, wrapTextWithPrefix } from '@clack/core';
import {
	limitOptions,
	S_BAR,
	S_BAR_END,
	S_CHECKBOX_ACTIVE,
	S_CHECKBOX_INACTIVE,
	S_CHECKBOX_SELECTED,
	S_BAR_H,
	symbol,
} from '@clack/prompts';
import fastStringWidth from 'fast-string-width';
import fmt from 'femtocolors';

/** @type {Array<[string, string]>} */
const MULTISELECT_INSTRUCTIONS = [
	['↑/↓', 'to navigate'],
	['space', 'select current'],
	// ['enter', 'confirm'],
];

/**
 * @param {string[]} instructions
 * @param {boolean} hasGuide
 * @param {number} columns
 * @returns {string[]}
 */
function formatInstructionFooter(instructions, hasGuide, columns) {
	const guidePrefix = hasGuide ? `${fmt.cyan(S_BAR)}  ` : '';

	const footerLines = instructions.reduce((lines, instruction) => {
		const cursor = lines.length - 1;
		const lastLine = lines[cursor];
		const updatedLine = lastLine + ' • ' + instruction;
		if (lastLine && fastStringWidth(updatedLine) < columns) {
			lines[cursor] = updatedLine;
		} else {
			lines.push(`${guidePrefix}${instruction}`);
		}
		return lines;
	}, /** @type {string[]} */ ([]));

	footerLines.unshift(
		guidePrefix + fmt.dim(S_BAR_H.repeat(columns - 2 * fastStringWidth(guidePrefix))),
	);

	if (hasGuide) {
		footerLines.push(fmt.cyan(S_BAR_END));
	}

	return footerLines;
}

/**
 * Custom multiselect prompt based on the official `groupMultiselect` prompt.
 * Supports grouping and custom interaction via new `shortcuts` and `beforeRender` configuration.
 *
 * @see https://bomb.sh/docs/clack/packages/prompts/#group-multiselect
 *
 * @example
 * ```ts
 * import { groupMultiselect } from '@clack/prompts';
 *
 * const result = await groupMultiselect({
 *  message: 'Define your project',
 *  options: {
 *      'Testing': [
 *          { value: 'Jest', hint: 'JavaScript testing framework' },
 *          { value: 'Playwright', hint: 'End-to-end testing' },
 *      ],
 *      'Language': [
 *          { value: 'js', label: 'JavaScript', hint: 'Dynamic typing' },
 *          { value: 'ts', label: 'TypeScript', hint: 'Static typing' },
 *      ],
 *  },
 *  shortcuts: [
 *    {
 *      label: 'a',
 *      hint: 'select all',
 *      handle({ key, prompt }) {
 *        if (key === 'a') {
 *          prompt.value =
 *            prompt.options.filter((option) => option.group !== true).map((option) => option.value);
 *        }
 *      }
 *    }
 *  ],
 * });
 * ```
 *
 * @template T
 * @param opts {import('@clack/prompts').GroupMultiSelectOptions<T> & {
 *    shortcuts?: Array<{
 *        label: string;
 *        hint: string;
 *        handle: (ctx: {
 *            key: string | undefined;
 *            info: import('node:readline').Key;
 *            prompt: import('@clack/core').GroupMultiSelectPrompt<import('@clack/prompts').Option<T>>;
 *            rerender: () => void;
 *        }) => void;
 *    }>;
 *    beforeRender?: (ctx: {
 *        prompt: import('@clack/core').GroupMultiSelectPrompt<import('@clack/prompts').Option<T>>;
 *        rerender: () => void;
 *    }) => void;
 * }} The options for the group multiselect prompt
 * @returns Promise<T[] | symbol>
 */
export const customMultiselect = (opts) => {
	const { selectableGroups = true, groupSpacing = 0 } = opts;

	/**
	 * Render a single option.
	 * @param {*} option
	 * @param {'inactive' | 'active' | 'selected' | 'active-selected' | 'group-active' | 'group-active-selected' | 'submitted' | 'cancelled'} state
	 * @param {*} options
	 * @returns
	 */
	const opt = (option, state, options = []) => {
		const label = option.label ?? String(option.value);
		const isItem = typeof option.group === 'string';
		const next = isItem && (options[options.indexOf(option) + 1] ?? { group: true });
		const isLast = isItem && next && next.group === true;
		let prefix = '';
		let prefixEnd = '';
		if (isItem) {
			if (selectableGroups) {
				prefix = isLast ? `${S_BAR_END} ` : `${S_BAR} `;
				prefixEnd = isLast ? `  ` : `${S_BAR} `;
			} else {
				prefix = '  ';
			}
		}
		let spacingPrefix = '';
		if (groupSpacing > 0 && !isItem) {
			spacingPrefix = '\n'.repeat(groupSpacing);
		}

		switch (state) {
			case 'active':
				return wrapTextWithPrefix(
					opts.output,
					`${label}${option.hint ? ` ${fmt.dim(`(${option.hint})`)}` : ''}`,
					`${spacingPrefix}${fmt.dim(prefix)} `,
					`${spacingPrefix}${fmt.dim(prefix)}${fmt.cyan(S_CHECKBOX_ACTIVE)} `,
					`${spacingPrefix}${fmt.dim(prefixEnd)} `,
				);
			case 'group-active':
				return wrapTextWithPrefix(
					opts.output,
					label,
					`${spacingPrefix}${prefix} `,
					`${spacingPrefix}${prefix}${fmt.cyan(S_CHECKBOX_ACTIVE)} `,
					`${spacingPrefix}${prefixEnd} `,
					(str) => fmt.dim(str),
				);
			case 'group-active-selected':
				return wrapTextWithPrefix(
					opts.output,
					label,
					`${spacingPrefix}${prefix} `,
					`${spacingPrefix}${prefix}${fmt.green(S_CHECKBOX_SELECTED)} `,
					`${spacingPrefix}${prefixEnd} `,
					(str) => fmt.dim(str),
				);
			case 'selected': {
				const selectedCheckbox = isItem || selectableGroups ? fmt.green(S_CHECKBOX_SELECTED) : '';
				return wrapTextWithPrefix(
					opts.output,
					`${label}${option.hint ? ` (${option.hint})` : ''}`,
					`${spacingPrefix}${fmt.dim(prefix)} `,
					`${spacingPrefix}${fmt.dim(prefix)}${selectedCheckbox} `,
					`${spacingPrefix}${fmt.dim(prefixEnd)} `,
					(str) => fmt.dim(str),
				);
			}
			case 'cancelled':
				return `${fmt.strikethrough.dim(label)}`;
			case 'active-selected':
				return wrapTextWithPrefix(
					opts.output,
					`${label}${option.hint ? ` ${fmt.dim(`(${option.hint})`)}` : ''}`,
					`${spacingPrefix}${fmt.dim(prefix)} `,
					`${spacingPrefix}${fmt.dim(prefix)}${fmt.green(S_CHECKBOX_SELECTED)} `,
					`${spacingPrefix}${fmt.dim(prefixEnd)} `,
				);
			case 'submitted':
				return `${fmt.dim(label)}`;
		}

		const unselectedCheckbox = isItem || selectableGroups ? fmt.dim(S_CHECKBOX_INACTIVE) : '';
		return wrapTextWithPrefix(
			opts.output,
			label,
			`${spacingPrefix}${fmt.dim(prefix)} `,
			`${spacingPrefix}${fmt.dim(prefix)}${unselectedCheckbox} `,
			`${spacingPrefix}${fmt.dim(prefixEnd)} `,
			(str) => fmt.dim(str),
		);
	};

	const required = opts.required ?? true;
	const showInstructions = opts.showInstructions ?? true;

	const beforeRender = () => {
		opts.beforeRender?.({
			prompt,
			// @ts-expect-error — We’re naughtily accessing the private internal render() method.
			rerender: () => prompt.render(),
		});
	};

	const prompt = new GroupMultiSelectPrompt({
		options: opts.options,
		signal: opts.signal,
		input: opts.input,
		output: opts.output,
		initialValues: opts.initialValues,
		required,
		cursorAt: opts.cursorAt,
		selectableGroups,

		validate(selected) {
			if (required && (selected === undefined || selected.length === 0))
				return (
					`Please select at least one option.\n` +
					`${fmt.reset(fmt.dim(`Press ${fmt.gray.bgWhite.inverse(' space ')} to select, ${fmt.gray.bgWhite.inverse(' enter ')} to submit`))}`
				);
		},

		render() {
			beforeRender();

			const columns = getColumns(opts.output || process.stdout);
			const hasGuide = opts.withGuide ?? settings.withGuide;
			const title = `${hasGuide ? `${fmt.gray(S_BAR)}\n` : ''}${symbol(this.state)}  ${opts.message}\n`;
			/** @type {typeof this.value} */
			const value = this.value ?? [];

			/**
			 * @param {import('@clack/prompts').Option<T>  & { group: string | boolean }} option
			 * @param {boolean} active
			 */
			const styleOption = (option, active) => {
				const options = this.options;
				const selected =
					value.includes(option.value) ||
					(option.group === true && this.isGroupSelected(`${option.value}`));
				const groupActive =
					!active &&
					typeof option.group === 'string' &&
					this.options[this.cursor]?.value === option.group;
				if (groupActive) {
					return opt(option, selected ? 'group-active-selected' : 'group-active', options);
				}
				if (active && selected) {
					return opt(option, 'active-selected', options);
				}
				if (selected) {
					return opt(option, 'selected', options);
				}
				return opt(option, active ? 'active' : 'inactive', options);
			};

			switch (this.state) {
				case 'submit': {
					const selectedOptions = this.options
						.filter(({ value: optionValue }) => value.includes(optionValue))
						.map((option) => opt(option, 'submitted'));
					const optionsText =
						selectedOptions.length === 0 ? '' : `  ${selectedOptions.join(fmt.dim(', '))}`;
					return `${title}${hasGuide ? fmt.gray(S_BAR) : ''}${optionsText}`;
				}
				case 'cancel': {
					const label = this.options
						.filter(({ value: optionValue }) => value.includes(optionValue))
						.map((option) => opt(option, 'cancelled'))
						.join(fmt.dim(', '));
					return `${title}${hasGuide ? `${fmt.gray(S_BAR)}  ` : ''}${label.trim() ? `${label}${hasGuide ? `\n${fmt.gray(S_BAR)}` : ''}` : ''}`;
				}
				case 'error': {
					const guidePrefix = hasGuide ? `${fmt.yellow(S_BAR)}  ` : '';
					const footer = this.error
						.split('\n')
						.map((ln, i) =>
							i === 0
								? `${hasGuide ? `${fmt.yellow(S_BAR_END)}  ` : ''}${fmt.yellow(ln)}`
								: `   ${ln}`,
						)
						.join('\n');
					// Calculate rowPadding: title lines + footer lines (error message + trailing newline)
					const titleLineCount = title.split('\n').length;
					const footerLineCount = footer.split('\n').length + 1; // footer + trailing newline
					const optionsText = limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						columnPadding: guidePrefix.length,
						rowPadding: titleLineCount + footerLineCount,
						style: styleOption,
					}).join(`\n${guidePrefix}`);
					return `${title}${guidePrefix}${optionsText}\n${footer}\n`;
				}
				default: {
					const guidePrefix = hasGuide ? `${fmt.cyan(S_BAR)}  ` : '';
					const titleLineCount = title.split('\n').length;
					const footerLines = showInstructions
						? formatInstructionFooter(
								[
									...MULTISELECT_INSTRUCTIONS,
									...(opts.shortcuts || []).map(({ label, hint }) => /** @type {const} */ [
										label,
										hint,
									]),
								].map(([key, desc]) => `${fmt.white.bgGray(` ${key} `)} ${desc}`),
								hasGuide,
								columns,
							)
						: hasGuide
							? [fmt.cyan(S_BAR_END)]
							: [];
					const footerText = footerLines.join('\n');
					const footerLineCount = footerLines.length + 1;
					const optionsText = limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						columnPadding: guidePrefix.length,
						rowPadding: titleLineCount + footerLineCount,
						style: styleOption,
					}).join(`\n${guidePrefix}`);
					return `${title}${guidePrefix}${optionsText}\n${footerText}\n`;
				}
			}
		},
	});

	prompt.on('key', (key, info) => {
		if (opts.shortcuts) {
			for (const shortcut of opts.shortcuts) {
				// @ts-expect-error — We’re naughtily accessing the private internal render() method.
				shortcut.handle({ key, info, prompt, rerender: prompt.render });
			}
		}
	});

	return prompt.prompt();
};
