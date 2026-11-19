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

import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Plugin } from "./plugin.js";


/**
 * The time in milliseconds between connection attempts to a proxy target not yet accepting connections.
 */
const Interval = 250;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a plugin holding the dev server back until the backends it proxies to accept connections.
 *
 * A web client launched together with its backend from a single script would otherwise load its first page before
 * the backend is up, with proxied requests failing. The dev server starts listening, and `--open` launches the
 * browser, only once every proxy target accepts TCP connections. The targets are read from `server.proxy`, so the
 * script launching both needs no separate wait step, and each backend address is stated in one place only:
 *
 * ```typescript
 * import { backend } from "@metreeca/rack/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({
 *   plugins: [backend()],
 *   server: { proxy: { "/api": "http://localhost:8080/" } }
 * });
 * ```
 *
 * Targets are checked if given as URL strings, either as the proxy entry itself or as its `target` field; targets
 * given as objects are not checked. A URL with no port is checked on the default port of its scheme.
 *
 * Only a dev server listening for requests of its own waits: production builds never do, nor do servers running in
 * middleware mode, such as the one Vitest starts, so a configuration shared with tests runs them with no backend.
 * Backend restarts while the dev server runs are not covered, and proxied requests fail until the backend is back.
 *
 * @param options The waiting settings
 *
 * @returns A plugin delaying dev server startup until every proxy target accepts connections, and failing startup
 * with an error naming the first target still unreachable once the timeout expires
 */
export function backend({

	timeout = 10_000

}: {

	/**
	 * The time in milliseconds the dev server waits for every proxy target before failing to start.
	 *
	 * @defaultValue `10_000`
	 */
	timeout?: number

} = {}): Plugin {

	return {

		name: "backend",
		apply: "serve",

		configureServer({ config: { server: { middlewareMode, proxy = {} } } }) {

			const deadline = Date.now()+timeout;

			return middlewareMode
				? Promise.resolve()
				: Promise.all(targets(proxy).map(target => ready(target, deadline))).then(() => undefined);

		}

	};

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Lists the distinct proxy targets given as URL strings, either as entries or as their `target` field.
 */
function targets(proxy: Readonly<Record<string, string | Readonly<{ target?: unknown }>>>): readonly URL[] {
	return [...new Set(Object.values(proxy)
		.map(entry => typeof entry === "string" ? entry : entry.target)
		.filter(target => typeof target === "string")
	)].map(url => new URL(url));
}

/**
 * Waits until a proxy target accepts connections, failing once the deadline passes with the target still unreachable.
 */
function ready(target: URL, deadline: number): Promise<void> {

	const host = target.hostname.replace(/^\[(.*)]$/, "$1"); // IPv6 literals come bracketed
	const port = Number(target.port) || (["https:", "wss:"].includes(target.protocol) ? 443 : 80);

	return accepts(host, port, deadline-Date.now()).then(connected => connected ? undefined

		: Date.now() >= deadline ? Promise.reject(new Error(`unreachable proxy target <${target.href}>`))

		: delay(Math.min(Interval,deadline-Date.now())).then(() => ready(target, deadline))
	);

}

/**
 * Checks whether a host accepts TCP connections on a port, giving up once the timeout expires.
 */
function accepts(host: string, port: number, timeout: number): Promise<boolean> {
	return new Promise(resolve => {

		const socket = connect({ host, port, timeout: Math.max(timeout, 1) });

		function settle(connected: boolean) {

			socket.destroy();
			resolve(connected);

		}

		socket
			.once("connect", () => settle(true))
			.once("timeout", () => settle(false))
			.once("error", () => settle(false));

	});
}
