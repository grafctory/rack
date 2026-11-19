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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { qc } from "./qc.js";


describe("qc()", { timeout: 60_000 }, () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-qc-")));

	let stdout: MockInstance; // assigned by the setup hook for each test


	/**
	 * Writes a package folder holding a manifest and a set of files keyed by relative path; `null` omits a file.
	 */
	function pkg(path: string, manifest: Readonly<Record<string, unknown>>, files: Readonly<Record<string, string | null>> = {}) {

		Object.entries({ "package.json": JSON.stringify(manifest), ...files })
			.flatMap(([file, content]) => content === null ? [] : [[file, content]])
			.forEach(([file, content]) => {
				mkdirSync(dirname(join(path, file)), { recursive: true });
				writeFileSync(join(path, file), content);
			});

		return path;

	}

	/**
	 * Writes a sound package exporting the module, declaration and asset files it ships.
	 */
	function sound(path: string, overrides: Readonly<Record<string, unknown>> = {}, files: Readonly<Record<string, string | null>> = {}) {
		return pkg(path, {
			name: "sound",
			version: "1.0.0",
			type: "module",
			files: ["dist"],
			exports: {
				".": { types: "./dist/index.d.ts", source: "./src/index.ts", default: "./dist/index.js" },
				"./style.css": "./dist/style.css",
				"./parts/*": "./dist/parts/*.js"
			},
			...overrides
		}, {
			"src/index.ts": "export {};\n",
			"dist/index.js": "export * from \"./util.js\";\n",
			"dist/util.js": "export const util = true;\n",
			"dist/index.d.ts": "export {};\n",
			"dist/style.css": "body {}\n",
			"dist/parts/a.js": "export {};\n",
			"dist/parts/a.d.ts": "export {};\n",
			"dist/parts/b.js": "export {};\n",
			"dist/parts/b.d.ts": "export {};\n",
			...files
		});
	}

	function printed() {
		return stdout.mock.calls.map(args => args.join(" "));
	}


	beforeEach(async () => {
		stdout = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("sound packages", () => {

		it("should check every exported subpath, expanding patterns", async () => {
			await expect(qc(sound(join(root, "sound")))).resolves.toBeUndefined();
			expect(printed()).toEqual(expect.arrayContaining([
				"qc sound", "qc sound/style.css", "qc sound/parts/a", "qc sound/parts/b"
			]));
		});

		it("should import modules importing the assets they ship, as bundlers load them", async () => {
			await expect(qc(sound(join(root, "styled"), {}, {
				"dist/index.js": "import \"./style.css\";\nexport * from \"./util.js\";\n"
			}))).resolves.toBeUndefined();
		});

		it("should skip subpaths excluded by a null target", async () => {

			const excluded = sound(join(root, "excluded"), {
				exports: {
					".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
					"./parts/*": "./dist/parts/*.js",
					"./parts/*.core": null,
					"./internal": null
				}
			}, {
				"dist/parts/a.core.js": "export {};\n",
				"dist/parts/a.core.d.ts": "export {};\n"
			});

			await expect(qc(excluded)).resolves.toBeUndefined();
			expect(printed()).not.toEqual(expect.arrayContaining([expect.stringMatching(/internal|\.core/)]));

		});

		it("should check the members of a workspace together, skipping private packages", async () => {

			const workspace = pkg(join(root, "workspace"), { name: "workspace", private: true, workspaces: ["packages/*"] });

			pkg(join(workspace, "packages", "base"), {
				name: "base", version: "1.0.0", type: "module", exports: "./index.js"
			}, {
				"index.js": "export const base = true;\n",
				"index.d.ts": "export declare const base: boolean;\n"
			});

			pkg(join(workspace, "packages", "user"), {
				name: "user", version: "1.0.0", type: "module", exports: "./index.js", dependencies: { base: "1.0.0" }
			}, {
				"index.js": "export { base } from \"base\";\n",
				"index.d.ts": "export { base } from \"base\";\n"
			});

			await expect(qc(workspace)).resolves.toBeUndefined();
			expect(printed()).toEqual(["qc base", "qc user"]);

		});

	});

	describe("broken packages", () => {

		it("should fail on files left out of the package", async () => {
			await expect(qc(sound(join(root, "unshipped"), {
				files: ["dist/index.js", "dist/index.d.ts", "dist/style.css", "dist/parts"]
			}))).rejects.toThrow(Error);
		});

		it("should fail on exported subpaths pointing at missing files", async () => {
			await expect(qc(sound(join(root, "dangling"), {
				exports: { ".": "./dist/index.js", "./missing": "./dist/missing.js" }
			}))).rejects.toThrow(Error);
		});

		it("should fail on undeclared runtime dependencies", async () => {
			await expect(qc(sound(join(root, "undeclared"), {}, {
				"dist/util.js": "export * from \"undeclared-qc-dependency\";\n"
			}))).rejects.toThrow(Error);
		});

		it("should fail on missing declarations", async () => {
			await expect(qc(sound(join(root, "untyped"), {}, {
				"dist/parts/b.d.ts": null
			}))).rejects.toThrow(Error);
		});

		it("should import modules shipped without declarations", async () => {
			await expect(qc(sound(join(root, "bare"), {}, {
				"dist/index.d.ts": null,
				"dist/util.js": "export * from \"undeclared-qc-dependency\";\n"
			}))).rejects.toThrow("undeclared-qc-dependency");
		});

		it("should fail on modules importing assets left out of the package", async () => {
			await expect(qc(sound(join(root, "dangling"), {}, {
				"dist/index.js": "import \"./missing.css\";\nexport * from \"./util.js\";\n"
			}))).rejects.toThrow(/failed import <sound>/);
		});

		it("should fail on missing assets", async () => {
			await expect(qc(sound(join(root, "unstyled"), {
				exports: { ".": "./dist/index.js", "./theme.css": "./dist/theme.css" }
			}))).rejects.toThrow(Error);
		});

		it("should fail on subpaths reachable only through custom conditions", async () => {
			await expect(qc(sound(join(root, "conditioned"), {
				exports: { ".": { source: "./src/index.ts" } }
			}))).rejects.toThrow(Error);
		});

		it("should list every broken subpath", async () => {

			const error = await qc(sound(join(root, "multiple"), {
				exports: { ".": "./dist/index.js", "./one": "./dist/one.js", "./two.css": "./dist/two.css" }
			})).then(() => undefined, (error: unknown) => error);

			expect(error).toBeInstanceOf(Error);
			expect(String(error)).toContain("sound/one");
			expect(String(error)).toContain("sound/two.css");

		});

	});

	describe("projects", () => {

		it("should fail on a folder with no package manifest", async () => {
			await expect(qc(join(root, "nothing"))).rejects.toThrow(Error);
		});

		it("should fail on a project with no publishable package", async () => {
			await expect(qc(pkg(join(root, "private"), { name: "private", private: true }))).rejects.toThrow(Error);
		});

	});

});
