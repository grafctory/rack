/*
 * Copyright © 2026 Metreeca srl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { type Outcome, start } from "../cmds.js";


/**
 * The operands accepted by {@link up}, one synopsis each.
 */
up.args = [

	"<command>",
	"[<arg>]...",
	"[+ <command> [<arg>]...]..."

];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Runs commands in parallel and stops them together.
 *
 * Runs on the command line as `ush up <command> [<arg>]... [+ <command> [<arg>]...]...`, with commands separated by a
 * standalone `+` and no quoting needed. Options following the first command belong to the commands, so only a leading
 * `--help` is read by the tool itself, and a command takes its own options exactly as it would if run on its own.
 *
 * Each command writes straight to the terminal, keeping colours, TTY detection and browser launch behaviour. The first
 * command to exit, successfully or not, stops the others together with every process they started, and interrupting
 * or terminating the tool stops every command as well, so that no watcher or server is left running in the background.
 * Commands cannot read from the terminal, so interactive prompts fail, and the tool runs on macOS and Linux only.
 *
 * On the command line, the tool exits with the status of the first command to exit, or with `1` if a signal ended it.
 *
 * @example
 *
 * Watching the docs while previewing them, from an npm script:
 *
 * ```shell
 * npx typedoc && ush up npx typedoc --watch + ush ws --open docs
 * ```
 *
 * @param args The commands with their arguments, separated by standalone `+` operands
 *
 * @returns A promise resolving once the first command to exit does so successfully and every other command is stopped
 *
 * @throws {@link !TypeError TypeError} If no command is provided, or a `+` separator lacks a command before or after it
 * @throws {@link !Error Error} If a command cannot be started, or the first command to exit fails or is ended by a
 * signal; the error names the command, and carries its exit status as `status` if it exited with one
 */
export async function up(...args: readonly string[]): Promise<void> {

	const commands = split(args);

	if ( commands.some(command => command.length === 0) ) {

		throw new TypeError("missing command operand");

	} else {

		const running = commands.map(([executable, ...rest]) => ({
			name: [executable, ...rest].join(" "),
			command: start(executable, rest)
		}));

		const first = Promise.race(running.map(({ name, command }) => command.exited.then(
			outcome => settle(name, outcome),
			(error: unknown) => Promise.reject(new Error(`unavailable command <${name}>`, { cause: error }))
		)));

		return first.finally(() => Promise.all(running.map(({ command }) =>
			command.stop().catch(() => undefined) // unstarted: nothing to stop
		)));

	}

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Splits operands into commands at each standalone `+`.
 */
function split(args: readonly string[]): readonly (readonly string[])[] {
	return args.reduce<readonly (readonly string[])[]>((commands, arg) => arg === "+"
		? [...commands, []]
		: [...commands.slice(0, -1), [...commands.at(-1) ?? [], arg]], [[]]
	);
}

/**
 * Maps the way the first command to exit ended to the outcome of the tool.
 */
function settle(name: string, outcome: Outcome): void {

	if ( "signal" in outcome ) {

		throw new Error(`command <${name}> terminated by <${outcome.signal}>`);

	} else if ( outcome.code !== 0 ) {

		throw Object.assign(new Error(`command <${name}> exited with status <${outcome.code}>`), {
			status: outcome.code
		});

	} else {

		return undefined;

	}

}
