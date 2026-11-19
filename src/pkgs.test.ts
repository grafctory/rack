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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declared, installed, loaded, locate, manifest, projects, reached, shared, survey } from "./pkgs.js";


describe("installed trees", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-tree-")));

	const project = join(root, "project");
	const member = join(project, "packages", "member");
	const checkout = join(root, "checkout");
	const modules = join(project, "node_modules");


	function pkg(path: string, manifest: Readonly<Record<string, unknown>>) {
		mkdirSync(path, { recursive: true });
		writeFileSync(join(path, "package.json"), JSON.stringify(manifest));
	}

	function link(target: string, path: string) {
		mkdirSync(join(path, ".."), { recursive: true });
		symlinkSync(target, path, "dir");
	}


	beforeAll(async () => {

		pkg(project, {
			name: "project",
			workspaces: ["packages/*"],
			dependencies: { direct: "^2.0.0", linked: "*", app: "*" },
			devDependencies: { tool: "*" }
		});

		pkg(join(modules, "app"), { name: "app", version: "1.0.0", dependencies: { framework: "*" } });
		pkg(join(modules, "framework"), {
			name: "framework",
			version: "1.0.0",
			peerDependencies: { context: "*", devtools: "*" },
			peerDependenciesMeta: { devtools: { optional: true } }
		});

		pkg(member, { name: "member", dependencies: { "member-dep": "*" } });
		mkdirSync(join(project, "packages", "bare"), { recursive: true }); // a member folder with no manifest

		pkg(checkout, { name: "linked", version: "0.1.0", peerDependencies: { "linked-peer": "*" } });
		pkg(join(checkout, "node_modules", "direct"), { name: "direct", version: "3.0.0" }); // settled by the checkout

		pkg(join(modules, "direct"), { name: "direct", version: "2.0.0" });
		pkg(join(modules, "tool"), { name: "tool", version: "1.0.0" });

		pkg(join(modules, "lib"), { name: "lib", version: "1.0.0", dependencies: { direct: "^1.0.0", helper: "*" } });
		pkg(join(modules, "lib", "node_modules", "direct"), { name: "direct", version: "1.0.0" });
		pkg(join(modules, "lib", "node_modules", "helper"), { name: "helper", version: "1.0.0" });

		pkg(join(modules, "other"), { name: "other", version: "1.0.0", dependencies: { helper: "*" } });
		pkg(join(modules, "other", "node_modules", "helper"), { name: "helper", version: "2.0.0" });

		pkg(join(modules, "host"), { name: "host", version: "1.0.0", peerDependencies: { peer: "*" } });
		pkg(join(modules, "peer"), { name: "peer", version: "1.0.0" });
		pkg(join(modules, "widget"), { name: "widget", version: "1.0.0", dependencies: { peer: "*" } });
		pkg(join(modules, "widget", "node_modules", "peer"), { name: "peer", version: "2.0.0" });

		pkg(join(modules, "@scope", "scoped"), { name: "@scope/scoped", version: "1.0.0" });
		mkdirSync(join(modules, ".bin"), { recursive: true });

		link(checkout, join(modules, "linked"));
		link(checkout, join(member, "node_modules", "linked"));
		pkg(join(member, "node_modules", "member-dep"), { name: "member-dep", version: "1.0.0" });

	});

	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("shared()", () => {

		it("should include linked packages and their peers", async () => {
			expect(shared(project)).toEqual(expect.arrayContaining(["linked", "linked-peer"]));
		});

		it("should include the dependencies of the project and of its workspace members", async () => {
			expect(shared(project)).toEqual(expect.arrayContaining(["direct", "tool", "member-dep"]));
		});

		it("should include the peers of installed packages", async () => {
			expect(shared(project)).toContain("peer");
		});

		it("should leave other dependencies out", async () => {
			expect(shared(project)).not.toContain("helper");
		});

		it("should list each package once", async () => {
			expect(new Set(shared(project)).size).toBe(shared(project).length);
		});

	});

	describe("loaded()", () => {

		it("should include linked packages and their peers", async () => {
			expect(loaded(project)).toEqual(expect.arrayContaining(["linked", "linked-peer"]));
		});

		it("should include the runtime dependencies of the project and of its workspace members", async () => {
			expect(loaded(project)).toEqual(expect.arrayContaining(["direct", "app", "member-dep"]));
		});

		it("should include the peers of packages reached through runtime dependencies", async () => {
			expect(loaded(project)).toContain("context");
		});

		it("should leave development dependencies out", async () => {
			expect(loaded(project)).not.toContain("tool");
		});

		it("should leave out the peers of packages no runtime dependency reaches", async () => {
			expect(loaded(project)).not.toContain("peer");
		});

		it("should leave optional peers out", async () => {
			expect(loaded(project)).not.toContain("devtools");
		});

		it("should leave other dependencies out", async () => {
			expect(loaded(project)).not.toContain("helper");
		});

		it("should list each package once", async () => {
			expect(new Set(loaded(project)).size).toBe(loaded(project).length);
		});

	});

	describe("reached()", () => {

		it("should include the copies the runtime dependencies of the project and of its members point to", async () => {
			expect(reached(project)).toEqual(expect.arrayContaining([
				join(modules, "direct"), join(modules, "app"), join(member, "node_modules", "member-dep")
			]));
		});

		it("should include the copies reached through dependencies of reached copies", async () => {
			expect(reached(project)).toContain(join(modules, "framework"));
		});

		it("should include linked checkouts reached through runtime dependencies", async () => {
			expect(reached(project)).toContain(checkout);
		});

		it("should leave out the copies reached only through development dependencies", async () => {
			expect(reached(project)).not.toContain(join(modules, "tool"));
		});

		it("should leave out the copies no runtime dependency reaches", async () => {
			expect(reached(project)).not.toContain(join(modules, "lib", "node_modules", "direct"));
		});

		it("should list each copy once", async () => {
			expect(new Set(reached(project)).size).toBe(reached(project).length);
		});

	});

	describe("survey()", () => {

		it("should list each copy of a direct dependency with its dependents", async () => {
			expect(survey(project).get("direct")).toEqual(new Map([
				[join(modules, "direct"), ["project"]],
				[join(modules, "lib", "node_modules", "direct"), ["lib"]]
			]));
		});

		it("should list each copy of a peer with its dependents", async () => {
			expect(survey(project).get("peer")).toEqual(new Map([
				[join(modules, "peer"), ["host"]],
				[join(modules, "widget", "node_modules", "peer"), ["widget"]]
			]));
		});

		it("should count links to the same checkout as a single copy", async () => {
			expect(survey(project).get("linked")).toEqual(new Map([
				[checkout, ["project"]]
			]));
		});

		it("should list a single copy of packages installed once", async () => {
			expect(survey(project).get("tool")).toEqual(new Map([
				[join(modules, "tool"), ["project"]]
			]));
		});

		it("should leave out packages outside the shared set", async () => {
			expect(survey(project).has("helper")).toBe(false);
		});

		it("should leave out packages the project does not install", async () => {
			expect(survey(project).has("linked-peer")).toBe(false);
		});

	});

	describe("projects()", () => {

		it("should list the root and its workspace members", async () => {
			expect(projects(project)).toEqual([project, member]);
		});

		it("should list nothing for a folder with no manifest", async () => {
			expect(projects(join(project, "packages", "bare"))).toEqual([]);
		});

	});

	describe("declared()", () => {

		it("should list dependencies", async () => {
			expect(declared(join(modules, "lib"))).toEqual(["direct", "helper"]);
		});

		it("should list peer dependencies", async () => {
			expect(declared(join(modules, "host"))).toEqual(["peer"]);
		});

		it("should leave development dependencies out by default", async () => {
			expect(declared(project)).not.toContain("tool");
		});

		it("should list development dependencies on request", async () => {
			expect(declared(project, true)).toEqual(expect.arrayContaining(["direct", "linked", "tool"]));
		});

	});

	describe("installed()", () => {

		function entry(path: string) {
			return installed(modules).find(({ path: candidate }) => candidate === path);
		}

		it("should list installed copies", async () => {
			expect(entry(join(modules, "direct"))).toEqual({
				name: "direct", modules, path: join(modules, "direct"), link: false
			});
		});

		it("should list nested copies", async () => {
			expect(entry(join(modules, "lib", "node_modules", "direct"))).toEqual({
				name: "direct",
				modules: join(modules, "lib", "node_modules"),
				path: join(modules, "lib", "node_modules", "direct"),
				link: false
			});
		});

		it("should list scoped packages", async () => {
			expect(entry(join(modules, "@scope", "scoped"))?.name).toBe("@scope/scoped");
		});

		it("should list links without entering them", async () => {
			expect(entry(join(modules, "linked"))?.link).toBe(true);
			expect(entry(join(modules, "linked", "node_modules", "direct"))).toBeUndefined();
		});

		it("should skip hidden entries", async () => {
			expect(installed(modules).map(({ name }) => name)).not.toContain(".bin");
		});

		it("should list nothing for a missing folder", async () => {
			expect(installed(join(root, "missing"))).toEqual([]);
		});

	});

	describe("locate()", () => {

		it("should locate the nearest installed entry", async () => {
			expect(locate("direct", join(modules, "lib"))).toBe(join(modules, "lib", "node_modules", "direct"));
		});

		it("should locate entries installed into an ancestor", async () => {
			expect(locate("direct", member)).toBe(join(modules, "direct"));
		});

		it("should locate links", async () => {
			expect(locate("linked", member)).toBe(join(member, "node_modules", "linked"));
		});

		it("should locate nothing for packages not installed", async () => {
			expect(locate("missing", project)).toBeUndefined();
		});

	});

});


describe("manifest()", () => {

	let folder: string; // a fresh package folder per test, so cached manifests never leak across tests

	function save(exports: Readonly<Record<string, string>>, modified = new Date()) {

		const file = join(folder, "package.json");

		writeFileSync(file, JSON.stringify({ name: "linked", exports }));
		utimesSync(file, modified, modified);

	}


	beforeEach(async () => {
		folder = realpathSync(mkdtempSync(join(tmpdir(), "rack-manifest-")));
	});

	afterEach(async () => {
		rmSync(folder, { recursive: true, force: true });
	});


	it("reads the saved manifest", async () => {

		save({ ".": "./a.js" });

		expect(manifest(folder)).toEqual({ name: "linked", exports: { ".": "./a.js" } });

	});

	it("reuses the manifest while its file is unchanged", async () => {

		save({ ".": "./a.js" });

		expect(manifest(folder)).toBe(manifest(folder));

	});

	it("reflects edits saved after a previous read", async () => {

		save({ ".": "./a.js" });
		manifest(folder);

		save({ ".": "./a.js", "./b": "./b.js" });

		expect(manifest(folder).exports).toEqual({ ".": "./a.js", "./b": "./b.js" });

	});

	it("reflects edits that leave the file size unchanged", async () => {

		save({ ".": "./a.js" }, new Date(2026, 0, 1));
		manifest(folder);

		save({ ".": "./b.js" }, new Date(2026, 0, 2));

		expect(manifest(folder).exports).toEqual({ ".": "./b.js" });

	});

	it("reflects edits that leave the modification time unchanged", async () => {

		save({ ".": "./a.js" }, new Date(2026, 0, 1));
		manifest(folder);

		save({ ".": "./a.js", "./b": "./b.js" }, new Date(2026, 0, 1));

		expect(manifest(folder).exports).toEqual({ ".": "./a.js", "./b": "./b.js" });

	});

});
