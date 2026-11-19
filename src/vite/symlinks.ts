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
import { bare, exported, external, linked, loaded, lookup, manifest, peers, reached, shared, survey } from "../pkgs.js";
import type { Plugin } from "./plugin.js";


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
 * Where no checkout is linked, as after a clean install, Vite and Vitest fail to start if a package the application
 * must load once at runtime is installed in more than one copy. A second copy splits the module state between the two
 * copies, yet tests and builds keep passing. The failure lists each duplicated package, with the version of every copy
 * and the packages pulling it in. Development tools and their own dependencies are not checked, and workspace members
 * linked by npm do not count as linked checkouts. Aligning the dependency ranges restores a single copy. A stateless
 * library that a dependency needs at a version of its own, as npm nests it, is left out of the check through `ignore`:
 * forcing a single version on it with `overrides` would run that dependency against an API it was not built for.
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
 * @returns A plugin resolving linked imports to source, loading a single copy of each package the project shares with
 * its linked packages, rejecting duplicate copies of those packages where no checkout is linked, letting the dev server
 * serve linked checkouts, and leaving any other import to the default resolution
 */
export function symlinks({

	conditions,
	ignore = []

}: {

	/**
	 * The export conditions mapping each subpath to its source file, as listed in `customConditions`; where a package
	 * matches more than one, the key order of its own `exports` decides which applies.
	 */
	conditions: string | readonly string[]

	/**
	 * The names of the packages whose duplicate copies are accepted, as for stateless libraries holding no module state
	 * the copies would split; defaults to none.
	 */
	ignore?: readonly string[]

}): Plugin {

	const $conditions = [conditions].flat();
	const $ignore = new Set(ignore);

	let names: ReadonlySet<string> = new Set(); // assigned by the config hook, once the project root is known
	let checkouts: readonly string[] = [];

	return {

		name: "symlinks",
		enforce: "pre",

		config({ root }) {

			const $root = resolve(root ?? "");

			names = new Set(shared($root));
			checkouts = external($root).map(path => `${path}${sep}`);

			const copies = checkouts.length ? [] : duplicates($root, $ignore);

			if ( copies.length ) {

				throw new Error([
					"duplicate copies of packages loaded once",
					...copies,
					"align the dependency ranges, or list stateless packages under the ignore option of symlinks()"
				].join("\n"));

			} else {

				return {
					resolve: {
						dedupe: linked($root).flatMap(path => [manifest(path).name, ...peers(path)])
					}
				};

			}

		},

		configResolved({ root, server }) {
			server.fs.allow.push(...linked(root)); // ;(mutation) Vite settles the list before this hook and reads it as is
		},

		resolveId(id, importer) {

			const { root } = this.environment.config;
			const name = bare(id);
			const base = importer && isAbsolute(importer) ? dirname(importer) : root;
			const link = name && (lookup(name, base) ?? lookup(name, root));

			if ( link ) {

				try {

					return exported(realpathSync(link), id, { conditions: $conditions }) ?? null;

				} catch { // dangling link

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


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Describes each package a project must load once and loads in more than one copy at runtime, one line per copy, the
 * packages listed in `ignore` left out.
 */
function duplicates(root: string, ignore: ReadonlySet<string>): readonly string[] {

	const copies = reached(root);
	const names = new Set(loaded(root, copies));
	const runtime = new Set(copies);

	return [...survey(root)]
		.filter(([name]) => names.has(name) && !ignore.has(name))
		.map(([name, copies]) => ({ name, copies: [...copies].filter(([path]) => runtime.has(path)) }))
		.filter(({ copies }) => copies.length > 1)
		.flatMap(({ name, copies }) => [name, ...copies.map(([path, dependents]) =>
			`  ${manifest(path).version ?? "unversioned"} ${path} <- ${dependents.join(", ")}`
		)]);

}
