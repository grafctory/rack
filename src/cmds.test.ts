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

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { start } from "./cmds.js";


describe("start()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-cmds-")));
	const module = fileURLToPath(new URL("./cmds.ts", import.meta.url));


	/**
	 * Builds a shell script starting a background sleep, saving its pid to a file, and waiting for it.
	 */
	function tree(file: string, prelude = "") {
		return `${prelude} sleep 30 & echo $! > '${file}'; wait`;
	}

	async function pid(file: string): Promise<number> { // the pid saved by a tree script, once the file is written

		const text = existsSync(file) ? readFileSync(file, "utf8").trim() : "";

		return text ? Number(text) : delay(20).then(() => pid(file));

	}

	function alive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	async function gone(pid: number, timeout = 2_000): Promise<boolean> { // waits for a process to disappear
		return !alive(pid) || timeout > 0 && delay(20).then(() => gone(pid, timeout-20));
	}

	/**
	 * Writes a Node script using the module, so that the current process of the module is a separate one.
	 */
	function script(name: string, body: string): string {

		const path = join(root, name);

		writeFileSync(path, `import { start } from ${JSON.stringify(module)};\n${body}\n`);

		return path;

	}


	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("outcome", () => {

		it("should resolve to the exit status of the command", async () => {
			await expect(start("sh", ["-c", "exit 3"]).exited).resolves.toEqual({ code: 3 });
		});

		it("should resolve to the signal that terminated the command", async () => {
			await expect(start("sh", ["-c", "kill -TERM $$"]).exited).resolves.toEqual({ signal: "SIGTERM" });
		});

		it("should pass arguments with no shell expansion", async () => {
			await expect(start("sh", ["-c", "test \"$0\" = '$HOME *'", "$HOME *"]).exited).resolves.toEqual({ code: 0 });
		});

		it("should reject if the command cannot be started", async () => {
			await expect(start(join(root, "missing")).exited).rejects.toThrow(Error);
		});

	});

	describe("output", () => {

		it("should write straight to the terminal of the current process", async () => {

			const { stdout } = spawnSync(process.execPath, [script("output.mjs", `
				await start("sh", ["-c", "echo marker"]).exited;
			`)], { encoding: "utf8" });

			expect(stdout).toContain("marker");

		});

	});

	describe("stop()", () => {

		it("should stop the command with the processes it started", async () => {

			const file = join(root, "stopped");
			const command = start("sh", ["-c", tree(file)]);
			const child = await pid(file);

			await expect(command.stop()).resolves.toEqual({ signal: "SIGTERM" });
			expect(await gone(child)).toBe(true);

		});

		it("should kill processes still running after the grace period", async () => {

			const file = join(root, "stubborn");
			const command = start("sh", ["-c", tree(file, "trap '' TERM;")]);
			const child = await pid(file);

			await expect(command.stop()).resolves.toEqual({ signal: "SIGKILL" });
			expect(await gone(child)).toBe(true);

		}, 15_000);

		it("should stop the processes left running by a command that already exited", async () => {

			const file = join(root, "orphan");
			const command = start("sh", ["-c", `sleep 30 & echo $! > '${file}'`]);
			const child = await pid(file);

			await command.exited;
			await command.stop();

			expect(await gone(child)).toBe(true);

		});

	});

	describe("process lifetime", () => {

		async function run(name: string, body: string, signal?: NodeJS.Signals) {

			const file = join(root, `${name}.pid`);
			const host = spawn(process.execPath, [script(`${name}.mjs`, body.replace("FILE", file))], {
				stdio: "ignore"
			});

			const child = await pid(file);
			const exit = new Promise(resolve => host.once("exit", (code, signal) => resolve({ code, signal })));

			if ( signal === undefined ) {

				return { exit: await exit, gone: await gone(child) }; // the host exits on its own

			} else {

				host.kill(signal);

				return { exit: await exit, gone: await gone(child) };

			}

		}

		const interruptions = ["SIGINT", "SIGTERM", "SIGHUP"] as const; // ;(cast) literal narrowing to NodeJS.Signals


		it.each(interruptions)("should stop running commands on %s", async signal => {
			expect(await run(signal, `
				start("sh", ["-c", ${JSON.stringify(tree("FILE"))}]);
			`, signal)).toEqual({ exit: { code: null, signal }, gone: true });
		});

		it("should stop running commands when the process exits", async () => {
			expect(await run("exit", `
				start("sh", ["-c", ${JSON.stringify(tree("FILE"))}]);
				setTimeout(() => process.exit(0), 200);
			`)).toEqual({ exit: { code: 0, signal: null }, gone: true });
		});

		it("should leave the default signal behaviour alone with no command running", async () => {

			const host = spawn(process.execPath, [script("idle.mjs", `
				await start("sh", ["-c", "exit 0"]).exited;
				setInterval(() => {}, 1_000);
			`)], { stdio: "ignore" });

			await delay(300);
			host.kill("SIGINT");

			expect(await new Promise(resolve => host.once("exit", (_, signal) => resolve(signal)))).toBe("SIGINT");

		});

	});

});
