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

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { up } from "./up.js";


describe("up()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-up-")));


	/**
	 * Builds a shell script starting a background sleep, saving its pid to a file, and waiting for it.
	 */
	function tree(file: string) {
		return `sleep 30 & echo $! > '${file}'; wait`;
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

	function failure(promise: Promise<void>): Promise<unknown> {
		return promise.then(() => undefined, (error: unknown) => error);
	}


	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("operands", () => {

		it("should reject a missing command", async () => {
			await expect(up()).rejects.toThrow(TypeError);
		});

		it.each([
			[["+", "sh"]],
			[["sh", "+"]],
			[["sh", "+", "+", "sh"]]
		])("should reject a separator with no command in %j", async args => {
			await expect(up(...args)).rejects.toThrow(TypeError);
		});

		it("should pass arguments looking like options or separators inside a command", async () => {
			await expect(up("sh", "-c", "test \"$0\" = '--watch+'", "--watch+")).resolves.toBeUndefined();
		});

	});

	describe("lifetime", () => {

		it("should resolve once the first command exits successfully", async () => {
			await expect(up("sh", "-c", "exit 0", "+", "sleep", "30")).resolves.toBeUndefined();
		});

		it("should stop the other commands with the processes they started", async () => {

			const file = join(root, "stopped");
			const running = up("sh", "-c", tree(file), "+", "sh", "-c", "sleep 0.2");
			const child = await pid(file);

			await expect(running).resolves.toBeUndefined();
			expect(await gone(child)).toBe(true);

		});

		it("should stop the other commands when the first one fails", async () => {

			const file = join(root, "failed");
			const running = up("sh", "-c", tree(file), "+", "sh", "-c", "sleep 0.2; exit 2");
			const child = await pid(file);

			await expect(running).rejects.toThrow(Error);
			expect(await gone(child)).toBe(true);

		});

	});

	describe("failures", () => {

		it("should carry the exit status of the first command to fail", async () => {
			expect(await failure(up("sh", "-c", "exit 3", "+", "sleep", "30"))).toMatchObject({ status: 3 });
		});

		it("should carry no exit status for a command ended by a signal", async () => {

			const error = await failure(up("sh", "-c", "kill -TERM $$", "+", "sleep", "30"));

			expect(error).toBeInstanceOf(Error);
			expect(error).not.toHaveProperty("status");

		});

		it("should reject a command that cannot be started", async () => {
			await expect(up(join(root, "missing"), "+", "sleep", "30")).rejects.toThrow(Error);
		});

	});

});
