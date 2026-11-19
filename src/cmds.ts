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

/**
 * Child command control for the tools running other commands, leaving no orphaned process behind.
 *
 * Commands write straight to the terminal of the current process, keeping colours, TTY detection and browser launch
 * behaviour. Each command is stopped together with every process it started, and every running command is stopped
 * as well when the current process is interrupted, terminated or exits. A tool stopped from the terminal or from an
 * IDE run configuration thus takes its commands down with it, leaving no watcher or server running in the background.
 *
 * Commands cannot read from the terminal: stopping a whole process tree requires each command to run detached from
 * it, so interactive prompts fail. A process a command starts detached on its own, such as a browser, is left alone,
 * and keeps running after the command stops. Supported on macOS and Linux only, with Windows left out of scope.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";


/**
 * The time in milliseconds processes are given to terminate before being killed.
 */
const Grace = 5_000;

/**
 * The time in milliseconds between checks for processes still running.
 */
const Interval = 20;

/**
 * The signals stopping every running command before taking their default effect on the current process.
 */
const Signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The process groups of the commands that may still have processes running, process-wide.
 */
const groups = new Set<number>();


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The way a command ended: the exit status it returned, or the signal that terminated it.
 */
export type Outcome = Readonly<{ code: number } | { signal: NodeJS.Signals }>

/**
 * A running command.
 */
export type Command = Readonly<{

	/**
	 * Settles once the command exits, with the way it ended; rejects if the command could not be started.
	 */
	exited: Promise<Outcome>

	/**
	 * Stops the command together with every process it started.
	 *
	 * Processes are asked to terminate first, and killed if any is still running after a short grace period, so that
	 * a process ignoring the request cannot outlive the command. Stopping a command that already exited still stops
	 * the processes it left running in the background, such as a server started by a script that returned at once.
	 *
	 * @returns A promise resolving to the way the command ended, once no process it started is left running
	 */
	stop(): Promise<Outcome>

}>


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Starts a command writing straight to the terminal of the current process.
 *
 * @param command The executable to run, looked up on the `PATH` as the shell does
 * @param args The arguments passed to the executable as they are, with no shell expansion
 *
 * @returns The running command
 */
export function start(command: string, args: readonly string[] = []): Command {

	const child = spawn(command, [...args], { stdio: "inherit", detached: true }); // detached: a process group of its own
	const group = child.pid;

	const exited = new Promise<Outcome>((resolve, reject) => child
		.once("error", reject)
		.once("exit", (code, signal) => resolve(signal !== null ? { signal } : { code: code ?? 1 }))
	);

	if ( group === undefined ) { // not started: the error event rejects exited

		return { exited, stop: () => exited };

	} else {

		retain(group);

		// a group with processes left running stays registered until stopped

		child.once("exit", () => signal(group, 0) ? undefined : release(group));

		return { exited, stop: () => terminate(group).then(() => exited) };

	}

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Registers a process group, watching the current process for signals and exit while any group is registered.
 */
function retain(group: number): void {

	const first = groups.size === 0;

	groups.add(group);

	return first ? attach() : undefined;

}

/**
 * Unregisters a process group, restoring the default signal behaviour once no group is left.
 */
function release(group: number): void {

	groups.delete(group);

	return groups.size === 0 ? detach() : undefined;

}

/**
 * Adds the signal and exit listeners of the module to the current process.
 */
function attach(): void {

	Signals.forEach(signal => process.on(signal, interrupt));
	process.on("exit", shutdown);

}

/**
 * Removes the signal and exit listeners of the module from the current process.
 */
function detach(): void {

	Signals.forEach(signal => process.off(signal, interrupt));
	process.off("exit", shutdown);

}

/**
 * Stops every running command, then lets the signal take its default effect on the current process.
 */
function interrupt(received: NodeJS.Signals): void {
	Promise.all([...groups].map(terminate)).then(() => process.kill(process.pid, received)); // listeners gone with the last group
}

/**
 * Kills every running command as the current process exits, with no time left to let them terminate.
 */
function shutdown(): void {
	[...groups].forEach(group => signal(group, "SIGKILL"));
}

/**
 * Stops a process group, killing it if any process is still running after the grace period.
 */
async function terminate(group: number): Promise<void> {

	signal(group, "SIGTERM");

	await vanished(group, Date.now()+Grace).then(gone => gone || signal(group, "SIGKILL") && vanished(group, Infinity));

	release(group);

}

/**
 * Waits for every process of a group to end.
 *
 * @returns `true` if no process of `group` is left running by `deadline`; `false` otherwise
 */
async function vanished(group: number, deadline: number): Promise<boolean> {
	return !signal(group, 0) || Date.now() < deadline && delay(Interval).then(() => vanished(group, deadline));
}

/**
 * Sends a signal to every process of a group, or with `0` only checks whether any of them is still running.
 *
 * @returns `true` if the group has a process left to receive the signal; `false` otherwise
 */
function signal(group: number, code: NodeJS.Signals | 0): boolean {
	try {

		return process.kill(-group, code);

	} catch { // no process left in the group

		return false;

	}
}
