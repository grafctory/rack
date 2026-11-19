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

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { type AddressInfo, connect, createServer as createSocketServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ProxyOptions } from "vite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { backend } from "./backend.js";


describe("backend()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-backend-")));

	const listeners: Server[] = [];


	function listen(port = 0, host = "127.0.0.1"): Promise<number> {
		return new Promise((resolve, reject) => {

			const listener = createSocketServer(socket => socket.end())
				.once("error", reject)
				.listen(port, host, () => resolve((listener.address() as AddressInfo).port)); // ;(cast) bound TCP server

			listeners.push(listener);

		});
	}

	function vacant(): Promise<number> { // a port nothing listens on, released as soon as it is assigned
		return new Promise((resolve, reject) => {

			const probe = createSocketServer()
				.once("error", reject)
				.listen(0, "127.0.0.1", () => {

					const { port } = probe.address() as AddressInfo; // ;(cast) bound TCP server

					probe.close(() => resolve(port));

				});

		});
	}

	function accepts(port: number): Promise<boolean> {
		return new Promise(resolve => {

			const socket = connect(port, "127.0.0.1")
				.once("connect", () => socket.end(() => resolve(true)))
				.once("error", () => resolve(false));

		});
	}

	function start(proxy: Readonly<Record<string, string | ProxyOptions>>, {

		timeout = 500,
		middlewareMode = false

	} = {}) {
		return createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode, hmr: false, ws: false, proxy: { ...proxy } },
			plugins: [backend({ timeout })]
		}).then(server => server.close());
	}


	afterEach(async () => {
		await Promise.all(listeners.splice(0).map(listener => new Promise(resolve => listener.close(resolve))));
	});

	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	it("should start once proxy targets accept connections", async () => {
		await expect(start({ "/api": `http://127.0.0.1:${await listen()}/` })).resolves.toBeUndefined();
	});

	it("should wait for targets that start accepting connections late", async () => {

		const port = await vacant();
		const late = new Promise(resolve => setTimeout(resolve, 200)).then(() => listen(port));

		await expect(start({ "/api": `http://127.0.0.1:${port}/` }, { timeout: 2_000 })).resolves.toBeUndefined();
		expect(await accepts(port)).toBe(true);

		await late;

	});

	it("should start once IPv6 proxy targets accept connections", async () => {
		await expect(start({ "/api": `http://[::1]:${await listen(0, "::1")}/` })).resolves.toBeUndefined();
	});

	it("should check targets given as target fields", async () => {
		await expect(start({ "/api": { target: `http://127.0.0.1:${await vacant()}/` } })).rejects.toThrow(Error);
	});

	it("should fail once the timeout expires with a target still unreachable", async () => {
		await expect(start({ "/api": `http://127.0.0.1:${await vacant()}/` })).rejects.toThrow(Error);
	});

	it("should fail if any of several targets is unreachable", async () => {
		await expect(start({
			"/api": `http://127.0.0.1:${await listen()}/`,
			"/data": `http://127.0.0.1:${await vacant()}/`
		})).rejects.toThrow(Error);
	});

	it("should not check targets given as objects", async () => {
		await expect(start({
			"/api": { target: { host: "127.0.0.1", port: await vacant() } }
		})).resolves.toBeUndefined();
	});

	it("should not wait in middleware mode", async () => {
		await expect(start({ "/api": `http://127.0.0.1:${await vacant()}/` }, {
			middlewareMode: true
		})).resolves.toBeUndefined();
	});

	it("should not wait for builds", async () => {
		expect(backend().apply).toBe("serve");
	});

});
