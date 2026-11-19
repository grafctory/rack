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

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { exports } from "resolve.exports";
import { bare, external, linked, lookup, manifest, shared } from "../symlinks.js";


/**
 * The plugin created by {@link symlinks}, accepted wherever a Vite or Vitest configuration takes a `Plugin`.
 *
 * The type is spelled out in full rather than imported from Vite, so that a project type-checking a configuration
 * against a linked `@metreeca/rack` checkout loads the Vite and `@types/node` declarations it installs for itself
 * only, never a second copy from the checkout. Vite and Vitest configurations thus type-check against the same
 * declarations whether `@metreeca/rack` is installed from the registry or linked to a local checkout.
 */
export type Plugin = Readonly<{

	name: string
	enforce: "pre"

	config(config: Readonly<{ root?: string }>): Readonly<{ resolve: Readonly<{ dedupe: string[] }> }> // mutable: as Vite declares it

	configResolved(config: Readonly<{ root: string, server: Readonly<{ fs: Readonly<{ allow: string[] }> }> }>): void // mutable: as Vite declares it

	resolveId(
		this: Readonly<{
			environment: Readonly<{ config: Readonly<{ root: string }> }>
			resolve(id: string, importer?: string, options?: Readonly<{ skipSelf?: boolean }>): Promise<Readonly<{
				id: string
			}> | null>
		}>,
		id: string,
		importer?: string
	): string | null | Promise<Readonly<{ id: string }> | null>

}>;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a plugin running tests against the live source of locally linked packages, with no rebuild.
 *
 * Imports of workspace members and of sibling checkouts linked into `node_modules` resolve to their TypeScript source,
 * so edits are picked up as they are saved, new `exports` subpaths of a linked package included, with no restart of
 * the dev server or watch session. Packages installed from the registry keep resolving to their published build.
 *
 * Packages are looked up as Node does, from the `node_modules` nearest to the importer up through its ancestors, so
 * links hoisted to a workspace root are found from any member; imports with no importer start from the Vite root.
 * A package the importer resolves to an installed copy is looked up again from the Vite root, so a linked checkout
 * importing a package the project links as well loads the linked source rather than its own registry copy.
 *
 * The project and its linked packages load a single copy of every package the project shares with them, as libraries
 * holding module state such as Preact hooks require: linked packages and their `peerDependencies`, the dependencies of
 * the project and of its workspace members, and the `peerDependencies` of any package installed there. A linked
 * checkout importing one of those packages loads the copy the project installs, whatever copies it installs for
 * itself; linked packages and their peers extend `resolve.dedupe` as well, so that dependencies prebundled by the
 * optimizer share them too. Any other dependency of a linked package resolves from its checkout, as Node does, since
 * the project shares no copy of it, and packages installed from the registry keep the copies npm settled for them.
 *
 * The dev server serves the files of linked checkouts wherever they live, including the dependencies each one installs.
 * Their real paths are added to `server.fs.allow`, next to the configured entries or, if none are configured, next to
 * the workspace root Vite allows by default. Checkouts linked after the server starts are served once it restarts.
 *
 * The plugin replaces `resolve.conditions`, which breaks registry packages whose exports name a condition without
 * publishing its target: Vite does not fall back to `default` when that target is missing from the installed files.
 *
 * @example
 *
 * Linked packages map each exported subpath to its source under a custom condition, next to the build:
 *
 * ```json
 * {
 *   "exports": {
 *     ".": { "source": "./src/index.ts", "default": "./dist/index.js" }
 *   }
 * }
 * ```
 *
 * The consuming project registers the plugin with the same condition in its Vite or Vitest configuration:
 *
 * ```typescript
 * import { symlinks } from "@metreeca/rack/vite";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   plugins: [symlinks({ conditions: "source" })]
 * });
 * ```
 *
 * @param options The resolution settings
 *
 * @returns A plugin resolving linked imports to source, deduplicating linked packages and their peers, letting the dev
 * server serve linked checkouts, and leaving all other imports to the default resolution
 */
export function symlinks({

	conditions

}: {

	/**
	 * The export conditions mapping each subpath to its source file, as listed in `customConditions`; where a package
	 * matches more than one, the key order of its own `exports` decides which applies.
	 */
	conditions: string | readonly string[]

}): Plugin {

	const $conditions = typeof conditions === "string" ? [conditions] : conditions;

	let names: ReadonlySet<string> = new Set(); // assigned by the config hook, once the project root is known
	let checkouts: readonly string[] = [];

	return {

		name: "symlinks",
		enforce: "pre",

		config({ root }) {

			const $root = resolve(root ?? "");

			names = new Set(shared($root));
			checkouts = external($root).map(path => `${path}${sep}`);

			return {
				resolve: {
					dedupe: linked($root).flatMap(path => [
						manifest(path).name, ...Object.keys(manifest(path).peerDependencies ?? {})
					])
				}
			};

		},

		configResolved({ root, server }) {
			server.fs.allow.push(...linked(root)); // ;(mutation) Vite settles the list before this hook and reads it as is
		},

		resolveId(id, importer) {

			const root = this.environment.config.root;
			const name = bare(id);
			const base = importer && isAbsolute(importer) ? dirname(importer) : root;
			const link = name && (lookup(name, base) ?? lookup(name, root));

			if ( link ) {

				try {

					const path = realpathSync(link);
					const target = exports(manifest(path), id, { conditions: $conditions })?.[0];

					return target === undefined ? null : resolve(path, target);

				} catch { // subpath not exported or excluded by a null target

					return null;

				}

			} else if ( name && names.has(name) && checkouts.some(path => importer?.startsWith(path)) ) {

				return this.resolve(id, join(root, "package.json"), { skipSelf: true })
					.then(resolved => resolved ?? this.resolve(id, importer, { skipSelf: true }));

			} else {

				return null;

			}

		}

	};

}
