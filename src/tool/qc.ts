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

import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { described, exported, manifest, projects } from "../pkgs.js";


/**
 * The module hooks loading shipped assets as bundlers do, sharing the extension of this module: tests preload the
 * TypeScript source through the type stripping of Node, while the compiled tool preloads the JavaScript build.
 */
const Assets = new URL(`./qc.core${extname(import.meta.filename)}`, import.meta.url).href;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The operands accepted by {@link qc}, one synopsis each.
 */
qc.args = [

	"[<root>]"

];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Checks the packages of a project as they ship, before they are published.
 *
 * Runs on the command line as `ush qc [<root>]`, typically as the last release step between the build and the
 * publishing. The name comes from the outbound quality control a warehouse runs before goods leave the dock.
 *
 * Tests usually run against sources, so the files a package actually ships are never exercised: a file left out of
 * `files`, an `exports` entry pointing at a missing module or an undeclared runtime dependency reaches the registry
 * unnoticed. The tool installs every publishable package from its packed tarball, workspace members included, with
 * nothing linked. It then resolves every exported subpath with the default Node conditions, exactly as a consumer
 * installing the packages from the registry would, and checks each target according to its kind:
 *
 * - **Modules**: JavaScript targets are imported, proving that they ship, that their relative imports resolve, and
 *   that every runtime dependency they import is declared in the manifest; importing runs their top-level code
 * - **Declarations**: the `.d.ts` file each JavaScript target exposes ships with the package, whether a `types`
 *   condition names it or it sits alongside the target, so that TypeScript consumers get typed imports
 * - **Assets**: other targets, such as stylesheets, ship in the package
 * - **Conditions**: a subpath reachable only through a custom condition, such as a source condition for linked
 *   development, fails to resolve, so that no such condition leaks into a plain consumer
 *
 * Subpath patterns are expanded against the files a package ships, and each match is checked. A package with no
 * `exports` field has nothing checked, and packages marked as `private` are skipped. Packing runs no lifecycle
 * script, so the packages must be built beforehand, or their build output is listed as missing files.
 *
 * Each checked subpath is printed on stdout as `qc <specifier>`. The tool fails listing every broken subpath, so that
 * a single run reports every defect. It needs network access whenever the packages declare runtime dependencies.
 *
 * @example
 *
 * Checking the packages after building them, before publishing:
 *
 * ```shell
 * npm run build && ush qc && npm publish
 * ```
 *
 * @param root The project root; defaults to the current folder
 *
 * @returns A promise resolving once every exported subpath of every publishable package checks out
 *
 * @throws {@link !Error Error} If `root` holds no package manifest or no publishable package, if the packages cannot
 * be packed or installed together in a scratch folder, or if any exported subpath of a publishable package is broken
 */
export async function qc(root: string = "."): Promise<void> {

	const $root = resolve(root);
	const packages = described($root) ? projects($root).filter(path => !manifest(path).private) : undefined;

	if ( packages === undefined ) {

		throw new Error(`missing package manifest <${$root}>`);

	} else if ( packages.length === 0 ) {

		throw new Error(`missing publishable package <${$root}>`);

	} else {

		const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ush-qc-")));

		try {

			const failures = await check(packages, scratch);

			if ( failures.length ) {
				throw new Error(failures.join("\n"));
			}

		} finally {

			rmSync(scratch, { recursive: true, force: true });

		}

	}

}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Packs, installs and checks a set of packages in a scratch folder.
 *
 * @returns A description of each broken subpath; empty if every exported subpath checks out
 */
async function check(packages: readonly string[], scratch: string): Promise<readonly string[]> {

	const packed = await Promise.all(packages.map(path => pack(path, scratch)));

	writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "ush-qc", private: true }));

	await run("npm", [
		"install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund",
		...packed.map(({ tarball }) => tarball)
	], scratch);

	return (await Promise.all(packed.map(({ name, files }) => checked(scratch, name, files)))).flat();

}

/**
 * Packs a package into a tarball in a folder, running no lifecycle script.
 *
 * @returns The name of the package, the path of its tarball and the paths of the files it ships, relative to its folder
 */
async function pack(path: string, folder: string) {

	type Packed = Readonly<{
		name: string
		filename: string
		files: readonly Readonly<{ path: string }>[]
	}>;

	const output: readonly Packed[] | Readonly<Record<string, Packed>> = JSON.parse(await run("npm", [ // trusted npm output
		"pack", "--json", "--ignore-scripts", "--pack-destination", folder
	], path));

	const packages: readonly Packed[] = Array.isArray(output) ? output : Object.values(output); // keyed by name from npm 12
	const [{ name, filename, files }] = packages;

	return { name, tarball: join(folder, filename), files: new Set(files.map(file => file.path)) };

}

/**
 * Checks the subpaths an installed package exports, printing each one as it is checked.
 *
 * @param scratch The scratch folder the package is installed into
 * @param name The name of the package
 * @param files The paths of the files the package ships, relative to its folder, which subpath patterns expand to
 *
 * @returns A description of each defect the exported subpaths show; empty if every one of them checks out
 */
async function checked(scratch: string, name: string, files: ReadonlySet<string>): Promise<readonly string[]> {

	const folder = join(scratch, "node_modules", name);
	const { exports } = manifest(folder);

	const entries = typeof exports === "object" && exports !== null && !Array.isArray(exports)
		? Object.entries(exports)
		: [];

	const keys = exports === undefined ? []
		: entries.some(([key]) => key.startsWith(".")) ? entries.flatMap(([key, value]) => value === null ? [] : [key])
			: ["."];

	return (await Promise.all(keys.flatMap(expand).map(inspect))).flat();


	function expand(key: string): readonly string[] { // a pattern resolves to its target, with the * left in place

		const [head = "", tail] = target(key)?.split("*") ?? [];

		return tail === undefined ? [key] : [...files].flatMap(file => file.startsWith(head) && file.endsWith(tail)
			? [key.replace("*", file.slice(head.length, file.length-tail.length))]
			: []
		).filter(subpath => target(subpath) !== undefined); // left out by a more specific null target

	}

	async function inspect(key: string): Promise<readonly string[]> {

		const subpath = specifier(key);
		const file = target(key);
		const script = file !== undefined && /\.[cm]?js$/.test(file);
		const types = script ? declarations(key, file) : undefined;

		console.log(`qc ${subpath}`);

		const problems = file === undefined ? ["unresolved subpath"] : [
			...(files.has(file) ? [] : [`missing file <${file}>`]),
			...(types === undefined || files.has(types) ? [] : [`missing declarations <${types}>`])
		];

		const failures = script && files.has(file) ? await imported(subpath, scratch) : [];

		return [...problems.map(problem => `${problem} for <${subpath}>`), ...failures];

	}

	function declarations(key: string, file: string): string {

		const types = target(key, ["types"]);

		return types !== undefined && /\.d\.[cm]?ts$/.test(types)
			? types
			: file.replace(/\.([cm]?)js$/, ".d.$1ts");

	}

	function target(key: string, conditions: readonly string[] = []): string | undefined {

		const path = exported(folder, specifier(key), { conditions });

		return path === undefined ? undefined : relative(folder, path);

	}

	function specifier(key: string): string {
		return `${name}${key.slice(1)}`;
	}

}

/**
 * Imports an exported module in a Node process of its own, resolving it as a plain consumer in a folder would.
 *
 * @returns A description of the failure if the module cannot be imported; empty otherwise
 */
function imported(specifier: string, folder: string): Promise<readonly string[]> {
	return run(process.execPath, ["--import", Assets, "--import", specifier, "--eval", ""], folder).then(
		() => [],
		(error: unknown) => [`failed import <${specifier}> (${cause(error)})`]
	);
}

/**
 * Extracts the error Node printed on stderr for a failed command, falling back to the message of the failure.
 */
function cause(error: unknown): string {

	const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
	const message = error instanceof Error ? error.message : String(error);

	return stderr.split("\n").find(line => /^\w*Error\b/.test(line)) ?? message;

}

/**
 * Runs a command to completion in a folder, isolated from the npm and Node settings of the current process.
 *
 * @returns The standard output of the command
 *
 * @throws {@link !Error Error} If the command fails, with its standard error
 */
async function run(command: string, args: readonly string[], cwd: string): Promise<string> {

	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
		!key.startsWith("npm_") && key !== "NODE_OPTIONS" // set by the npm script or test runner launching the tool
	));

	const { stdout } = await promisify(execFile)(command, args, { cwd, env, maxBuffer: 64*1024*1024 });

	return stdout;

}
