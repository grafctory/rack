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
 * Package inspection for the resolvers and tools running a project against its locally linked checkouts.
 *
 * A project is read as npm installs it: the packages it is made of, the dependencies they declare, and every copy
 * installed into its `node_modules` folders, links to local checkouts included. From that view the module derives the
 * packages a project must load a single copy of and the copies it actually installs, so that every resolver and tool
 * in the package works from the same picture. Module specifiers are matched to the packages they name and to the files
 * those packages export. Manifests are read as currently saved, with no registry access.
 *
 * @module
 */

import { existsSync, globSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, parse, relative, resolve, sep } from "node:path";
import { exports, type Options, type Package } from "resolve.exports";


/**
 * The package manifests read by {@link manifest}, keyed by package folder path and reused until their file changes.
 */
const manifests = new Map<string, Readonly<{

	stamp: string // the modification time in nanoseconds and the size of the file the manifest was read from
	manifest: Manifest

}>>();


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Lists the packages a project must load a single copy of.
 *
 * The set is derived from what packages declare about themselves, with no scope wired in: a package linked into the
 * project and the peers it declares, a dependency of a package the project is made of, and a peer declared by any
 * installed package. Each of these is shared with the host by intent, so a second copy splits the module state the two
 * hold, such as framework contexts, service locators, branding symbols or logging configuration.
 *
 * Development dependencies count as well, since the tools a project runs load them next to its own code. Links and
 * installed packages are found in the `node_modules` of the project, of its ancestors and of its workspace members.
 *
 * @param root The project root
 *
 * @returns The names of the packages in the set, without duplicates
 */
export function shared(root: string): readonly string[] {

	return single(root, tree(root));

}

/**
 * Lists the packages a project must load a single copy of at runtime.
 *
 * The set narrows {@link shared} to what the application itself loads, leaving development tools out: a package
 * linked into the project and the peers it requires, a runtime dependency of a package the project is made of, and a
 * peer required by an installed package the project reaches through its runtime dependencies. Peers declared optional
 * are left out, since the declaring package runs without them and they hold no state it relies on sharing.
 *
 * @param root The project root
 * @param copies The copies the project loads at runtime, as listed by {@link reached}, for callers already holding them
 *
 * @returns The names of the packages in the set, without duplicates
 */
export function loaded(root: string, copies: readonly string[] = reached(root)): readonly string[] {

	return unique([

		...linked(root).flatMap(path => [manifest(path).name, ...required(path)]),

		...projects(root).flatMap(path => declared(path)),

		...copies.flatMap(required)

	]);

}

/**
 * Lists the installed copies a project loads at runtime.
 *
 * A copy is loaded where a runtime dependency resolves to it, as Node resolves it from the declaring package: from the
 * project and its workspace members first, then from every copy reached so far. Linked checkouts count as copies, and
 * so do the copies a checkout installs for itself, although they lie outside the installed tree {@link survey} lists.
 * Copies reached only through development dependencies are left out, since only development tools load them.
 *
 * @param root The project root
 *
 * @returns The real paths of the copies loaded at runtime, without duplicates
 */
export function reached(root: string): readonly string[] {

	return [...closure(projects(root).flatMap(copies))];


	function closure(paths: readonly string[], closed: ReadonlySet<string> = new Set()): ReadonlySet<string> {

		const fresh = unique(paths).filter(path => !closed.has(path));

		return fresh.length
			? closure(fresh.flatMap(copies), new Set([...closed, ...fresh]))
			: closed;

	}

	function copies(path: string): readonly string[] {

		return declared(path).flatMap(name => resolved(name, path));

	}

}

/**
 * Lists the checkouts a project links.
 *
 * @param root The project root
 *
 * @returns The real paths of the packages linked into the `node_modules` of `root`, of its ancestors and of its
 * workspace members, without duplicates, even where several links point to the same checkout
 */
export function linked(root: string): readonly string[] {

	return checkouts(tree(root));

}

/**
 * Lists the checkouts a project links from outside itself.
 *
 * These are the checkouts that install copies of their own next to the ones the project installs, so that a package
 * they import is loaded twice unless it is resolved from the project; workspace members, which npm links for the
 * project, share its copies already.
 *
 * @param root The project root
 *
 * @returns The real paths {@link linked} lists, the workspace members of `root` left out
 */
export function external(root: string): readonly string[] {

	const members = new Set(projects(root).map(path => realpathSync(path)));

	return linked(root).filter(path => !members.has(path));

}

/**
 * Lists the installed copies of the packages a project must load once, along with the packages loading each copy.
 *
 * Nested copies are surveyed as well. Entries linking to the same checkout count as a single copy, since they load the
 * same files. A package listed with more than one copy is loaded more than once, splitting the state it holds.
 *
 * @param root The project root
 *
 * @returns The copies of each package {@link shared} lists, keyed by package name; each copy is keyed by its real path
 * and lists the packages whose declared dependency resolves to it, the project and its workspace members included.
 * Packages the project does not install are left out, as they have no copy to survey.
 */
export function survey(root: string): ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> {

	const entries = tree(root);
	const names = new Set(single(root, entries));

	const copies = entries
		.filter(({ name, path }) => names.has(name) && described(path))
		.map(({ name, path }) => ({ name, path: realpathSync(path) }));

	const edges = [
		...projects(root).flatMap(path => dependencies(path, true)),
		...copied(entries).flatMap(({ path }) => dependencies(path, false))
	];

	return new Map(unique(copies.map(({ name }) => name)).map(name => [name, dependents(name)]));


	function dependencies(
		path: string,
		dev: boolean
	): readonly Readonly<{ name: string, copy: string, dependent: string }>[] {

		const dependent = manifest(path).name;

		return declared(path, dev)
			.filter(name => names.has(name))
			.flatMap(name => resolved(name, path).map(copy => ({ name, copy, dependent })));

	}

	function dependents(name: string): ReadonlyMap<string, readonly string[]> {

		return new Map(unique(copies.filter(copy => copy.name === name).map(({ path }) => path)).map(path => [path,
			edges.filter(edge => edge.name === name && edge.copy === path).map(({ dependent }) => dependent)
		]));

	}

}

/**
 * Lists the packages a project is made of.
 *
 * @param root The project root
 *
 * @returns The paths of `root` and of the workspace members its manifest declares, members without a manifest left out;
 * empty if `root` has no manifest, since a folder without one is neither a package nor a workspace for npm
 */
export function projects(root: string): readonly string[] {

	return described(root) ? [root, ...(manifest(root).workspaces ?? [])
		.flatMap(pattern => globSync(pattern, { cwd: root }))
		.map(member => join(root, member))
		.filter(described)
	] : [];

}

/**
 * Lists the dependencies a package declares.
 *
 * @param path The path of the package folder
 * @param dev Whether `devDependencies` are included, as they are for the packages a project is made of
 *
 * @returns The names in the `dependencies`, `peerDependencies` and `optionalDependencies` of the package at `path`,
 * along with its `devDependencies` if `dev` is set, in declaration order and without duplicates
 */
export function declared(path: string, dev: boolean = false): readonly string[] {

	const { dependencies, devDependencies, peerDependencies, optionalDependencies } = manifest(path);

	return Object.keys({

		...dependencies,
		...(dev ? devDependencies : {}),
		...peerDependencies,
		...optionalDependencies

	});

}

/**
 * Lists the packages installed into a `node_modules` folder.
 *
 * Nested copies are listed as well, down through the `node_modules` of each installed copy; links are listed but not
 * entered, since a linked checkout installs and settles its own dependencies through its own setup.
 *
 * @param modules The path of the `node_modules` folder
 *
 * @returns The packages installed into `modules` and into the `node_modules` of its installed copies, hidden entries
 * such as `.bin` excluded; empty if `modules` does not exist or is not a folder
 */
export function installed(modules: string): readonly Installed[] {

	return children(modules)
		.filter(entry => !entry.startsWith(".")) // hidden entries such as .bin
		.flatMap(entry => entry.startsWith("@")
			? children(join(modules, entry)).map(member => `${entry}/${member}`)
			: [entry]
		)
		.flatMap(name => nested(modules, name));

}

/**
 * Matches the package name a module specifier starts with.
 *
 * @param specifier The module specifier to match
 *
 * @returns The scoped or bare package name at the start of `specifier`, subpath excluded; `undefined` for specifiers
 * that no `node_modules` lookup can resolve: relative and absolute paths, URLs, `node:` builtins and virtual module
 * ids prefixed with `\0`, which bundler plugins reserve for modules with no file behind them
 */
export function bare(specifier: string): string | undefined {

	return specifier.match(/^(?![./\0]|[a-z]+:)(@[^/]+\/)?[^/]+/i)?.[0];

}

/**
 * Looks a package up as Node does, from the `node_modules` nearest to a directory up through its ancestors.
 *
 * @param name The name of the package to look up
 * @param directory The directory the lookup starts from
 *
 * @returns The path of the `node_modules` entry of `name`, if it is a symbolic link; `undefined` if the package is
 * not found or is an installed copy, which the default resolution handles as it does for any registry package
 */
export function lookup(name: string, directory: string): string | undefined {

	const path = locate(name, directory);

	return path !== undefined && lstatSync(path).isSymbolicLink() ? path : undefined;

}

/**
 * Locates the installed entry of a package as Node does, from the nearest `node_modules` up through its ancestors.
 *
 * @param name The name of the package to locate
 * @param directory The directory the lookup starts from
 *
 * @returns The `node_modules` entry of `name`, link or copy; `undefined` if none from `directory` upwards holds it
 */
export function locate(name: string, directory: string): string | undefined {

	return (createRequire(join(directory, sep)).resolve.paths(name) ?? []) // trailing separator: a folder, not a file
		.map(modules => join(modules, name))
		.find(candidate => lstatSync(candidate, { throwIfNoEntry: false }));

}

/**
 * Resolves a module specifier to the file a package exports for it.
 *
 * @param path The real path of the package folder
 * @param specifier The module specifier to resolve, naming the package or one of its subpaths
 * @param options The export conditions to match, and whether the import is a `require` call
 *
 * @returns The absolute path of the file the `exports` of the package at `path` map `specifier` to; `undefined` if the
 * subpath is not exported, is excluded by a null target, or the package has no readable manifest
 */
export function exported(path: string, specifier: string, options: Options): string | undefined {

	try {

		const target = exports(manifest(path), specifier, options)?.[0];

		return target === undefined ? undefined : resolve(path, target);

	} catch { // subpath not exported, excluded by a null target, or no readable manifest

		return undefined;

	}

}

/**
 * Reads a package manifest.
 *
 * Edits saved while the process runs, such as new `exports` subpaths in a linked checkout, take effect on the next
 * call, while an unchanged manifest is reused from memory without reading its file again.
 *
 * @param path The path of the package folder
 *
 * @returns The manifest of the package at `path`, as currently saved
 */
export function manifest(path: string): Manifest {

	const file = join(path, "package.json");
	const { mtimeNs, size } = statSync(file, { bigint: true });

	const stamp = `${mtimeNs}:${size}`;
	const cached = manifests.get(path);

	if ( cached?.stamp === stamp ) {

		return cached.manifest;

	} else {

		const parsed: Manifest = JSON.parse(readFileSync(file, "utf8")); // trusted local file

		manifests.set(path, { stamp, manifest: parsed });

		return parsed;

	}

}

/**
 * Checks whether a folder holds a package.
 *
 * @param path The path of the folder
 *
 * @returns `true` if `path` holds a `package.json` file; `false` otherwise, including where `path` is not a folder
 */
export function described(path: string): boolean {

	return existsSync(join(path, "package.json"));

}

/**
 * Lists the entries of a folder.
 *
 * @param path The path of the folder
 *
 * @returns The names of the entries of `path`; empty if `path` does not exist or is not a folder
 */
export function children(path: string): readonly string[] {

	return statSync(path, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(path) : [];

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The package manifest fields the linked package resolvers and the `ln` command rely on.
 */
type Manifest = Package & Readonly<{

	bin?: string | Readonly<Record<string, string>>
	workspaces?: readonly string[]

	dependencies?: Readonly<Record<string, string>>
	devDependencies?: Readonly<Record<string, string>>
	peerDependencies?: Readonly<Record<string, string>>
	peerDependenciesMeta?: Readonly<Record<string, Readonly<{ optional?: boolean }>>>
	optionalDependencies?: Readonly<Record<string, string>>

}>

/**
 * A package installed into a `node_modules` folder, either as a copy or as a link to a local checkout.
 */
type Installed = Readonly<{

	/**
	 * Whether the entry is a symbolic link to a local checkout rather than an installed copy.
	 */
	link: boolean

	/**
	 * The package name, scope included.
	 */
	name: string

	/**
	 * The `node_modules` folder holding the package.
	 */
	modules: string

	/**
	 * The path of the package entry inside {@link Installed.modules}.
	 */
	path: string

}>


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Lists the packages installed for a project, over the `node_modules` of its root, ancestors and members.
 */
function tree(root: string): readonly Installed[] {

	return unique([...ancestors(root), ...projects(root)])
		.flatMap(directory => installed(join(directory, "node_modules")));

}

/**
 * Lists a directory and its ancestors, the file system root excluded.
 */
function ancestors(directory: string): readonly string[] {

	const { root } = parse(directory);
	const segments = relative(root, directory).split(sep).filter(Boolean);

	return segments.map((_, index) => join(root, ...segments.slice(0, segments.length-index)));

}

/**
 * Lists an installed package and, unless it is a link, the packages installed into its own `node_modules`.
 */
function nested(modules: string, name: string): readonly Installed[] {

	const path = join(modules, name);
	const link = lstatSync(path).isSymbolicLink();

	return [{ name, modules, path, link }, ...(link ? [] : installed(join(path, "node_modules")))];

}

/**
 * Computes the set {@link shared} lists from the packages installed for a project.
 */
function single(root: string, entries: readonly Installed[]): readonly string[] {

	return unique([

		...checkouts(entries).flatMap(path => [manifest(path).name, ...peers(path)]),

		...projects(root).flatMap(path => declared(path, true)),

		...copied(entries).flatMap(({ path }) => peers(path))

	]);

}

/**
 * Lists the real paths of the checkouts linked among installed packages, dangling links left out.
 */
function checkouts(entries: readonly Installed[]): readonly string[] {

	return unique(entries
		.filter(({ link, path }) => link && described(path))
		.map(({ path }) => realpathSync(path))
	);

}

/**
 * Lists the installed copies among installed packages, entries without a manifest left out.
 */
function copied(entries: readonly Installed[]): readonly Installed[] {

	return entries.filter(({ link, path }) => !link && described(path));

}

/**
 * Lists the peers a package declares, those declared optional included.
 */
function peers(path: string): readonly string[] {

	return Object.keys(manifest(path).peerDependencies ?? {});

}

/**
 * Resolves a dependency of a package to the real path of the copy it loads, empty if none with a manifest is installed.
 */
function resolved(name: string, path: string): readonly string[] {

	const entry = locate(name, path);

	return entry !== undefined && described(entry) ? [realpathSync(entry)] : [];

}

/**
 * Lists the peers a package requires, those declared optional left out.
 */
function required(path: string): readonly string[] {

	const { peerDependenciesMeta } = manifest(path);

	return peers(path).filter(name => !peerDependenciesMeta?.[name]?.optional);

}

/**
 * Removes duplicates from a list, keeping the first occurrence of each value.
 */
function unique<T>(values: readonly T[]): readonly T[] {

	return [...new Set(values)];

}
