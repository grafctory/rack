# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> Published as `@grafctory/rack` from version 0.8.2; earlier versions were published as `@metreeca/rack`.

## [Unreleased](https://github.com/grafctory/rack/compare/v0.8.2...HEAD)

## [0.8.2](https://github.com/grafctory/rack/compare/v0.8.1...v0.8.2) - 2026-11-24

### Changed

- Package renamed to `@grafctory/rack` and repository moved to the `grafctory` GitHub organisation; install
  `@grafctory/rack` and import its subpaths (`/tool`, `/node`, `/vite`) under the new name

## [0.8.1](https://github.com/metreeca/rack/compare/v0.8.0...v0.8.1) - 2026-11-24

### Changed

- Maintenance release with no change to the published API or behaviour

## [0.8.0](https://github.com/metreeca/rack/compare/v0.7.0...v0.8.0) - 2026-11-19

### Added

- `backend()` Vite plugin holds the dev server, and the browser `--open` launches, until every `server.proxy` target
  accepts connections, so a client started together with its local backend no longer needs `wait-on`; the dev server
  fails to start once `timeout` expires with a target still unreachable, and servers in middleware mode never wait
- `ush up <command> [<arg>]... [+ <command> [<arg>]...]...` runs commands in parallel, writing straight to the
  terminal; the first command to exit, or an interrupt, stops the others with every process they started, so no
  watcher outlives the script, and the tool exits with the status of the first command to exit
- `ush qc [<root>]` packs every publishable package, installs the tarballs into a scratch folder with nothing linked,
  and imports every exported subpath as a plain consumer would, failing on files left out of the package, missing
  declarations, undeclared runtime dependencies and subpaths reachable only through a custom source condition

### Changed

- `@metreeca/rack/node` hooks and the `symlinks` plugin load a single copy of every package a project shares with its
  linked checkouts: the dependencies of the project and of its workspace members, and the peers any installed package
  declares, next to linked packages and their peers, so libraries holding module state never split across copies
- `symlinks` plugin fails Vite and Vitest startup when no checkout is linked, as after `npm ci`, and a package the
  application loads at runtime is installed in more than one copy, listing the version and dependents of each copy;
  duplicates reached only through development tools stay silent, and stateless libraries a dependency needs at a
  version of its own, as npm nests them, are accepted through the `ignore` option of the plugin
- The Vite `Plugin` type returned by the plugins declares every hook as optional, so it covers both `symlinks` and
  `backend`; configurations passing it to Vite are unaffected, while code calling its hooks directly must check them

### Fixed

- `@metreeca/rack/node` hooks and the `symlinks` plugin rooted inside a workspace member, as for a client run from its
  own folder, read the project as the workspace declaring it: fellow members no longer pass for linked checkouts, so
  their dependencies keep the copies npm settled, and the duplicate check covers only the copies that member loads
- `ush` messages read `ush:` rather than `index:` when the script runs directly, as through a Windows command shim

## [0.7.0](https://github.com/metreeca/rack/compare/v0.6.1...v0.7.0) - 2026-11-17

### Added

- `ush ws [--open[=<page>]] <root>` previews a folder in the browser and reloads open pages whenever its content
  changes; `--open` also opens the browser on the folder, or on one of its pages. The folder may be missing at startup
  or rebuilt while served, so the server runs alongside generators such as `typedoc --watch` with no initial build
- Tools accepting options take them through their `with()` method when called as functions, as in
  `ws.with({ open: "api/" })("docs")`, and take only the operands when called directly, as `ws("docs")` does

### Changed

- `--help` now lists the options a tool accepts along with its operands; the operand synopsis of `cp`, `rm` and `ln`
  moved accordingly from their `usage` string to an `args` array, with one entry per operand and no options listed

### Fixed

- `@metreeca/rack/node` hooks read `tsconfig.json` chains as TypeScript does, so linked packages run from the same
  sources `tsc` and the IDE check: configurations carrying a byte order mark, comments or trailing commas no longer
  crash the import, and `extends` resolves extensionless paths, packages, files inside packages and arrays of bases
- `@metreeca/rack/node` hooks fail with an error naming the offending file when a configuration in the chain is
  malformed, extends an unresolvable base or extends itself, instead of silently running linked packages from `dist`
- Linked package manifests are read again whenever they change, so `exports` edits in a linked checkout take effect in
  a running Vite dev server or Vitest watch session, which no longer fail to resolve new subpaths until restarted
- `symlinks` plugin lets the Vite dev server serve linked checkouts outside the workspace root, along with the
  dependencies they install, so their files no longer fail with a 403 error; linked checkouts are added to
  `server.fs.allow` next to its configured entries, or next to the workspace root Vite allows when none are configured

## [0.6.1](https://github.com/metreeca/rack/compare/v0.6.0...v0.6.1) - 2026-10-29

### Fixed

- `symlinks` plugin typed with no import from Vite, so a project type-checking its Vite or Vitest configuration
  against a linked `@metreeca/rack` checkout no longer loads a second copy of the Vite and `@types/node`
  declarations from the checkout, which crashed `tsc` with `Debug Failure. False expression: parameter should have
  errors when reporting errors` whenever the two copies disagreed; the `vite` entries projects added to `paths` in
  `tsconfig.json` to work around the crash are no longer needed and can be removed from every consumer
- `symlinks` plugin leaves virtual module ids prefixed with `\0` to the default resolution, so `vite build` no
  longer crashes with a null byte path error on modules Vite injects with no file behind them, such as
  `\0vite/preload-helper` in bundles including a dependency with a dynamic import

## [0.6.0](https://github.com/metreeca/rack/compare/v0.5.0...v0.6.0) - 2026-10-23

### Added

- `@metreeca/rack/node` module hooks running a Node process against the TypeScript source of linked packages, so a
  script, a server or an IDE run configuration started with `node --import @metreeca/rack/node` picks up sibling
  edits with no rebuild; the hooks read the conditions from the nearest `tsconfig.json`, leave installed packages on
  their build, load a single copy of each linked package and its peers, and resolve the `.js` relative imports of
  TypeScript sources to the `.ts` files next to them, so no loader such as `tsx` is needed for erasable syntax
- `symlinks` plugin deduplicating linked packages along with their peers, and resolving a package a linked checkout
  installs for itself from the project links, so a project loads one copy of each shared package from its working
  tree whatever its linked checkouts have installed, with no setup to repeat after an install in a checkout

### Changed

- `cp`, `ln` and `rm` run as subcommands of a single `ush` command, as in `ush rm dist`, rather than as commands of
  their own, which shadowed system commands with the same name in npm scripts and global installs; scripts calling
  the bare commands have to prefix them with `ush`, and error messages are prefixed with the full command
- `ln` no longer replaces the copies installed inside linked checkouts, so an install in one checkout never changes
  what another project loads and a checkout shared by several projects serves all of them alike; checkouts that
  relied on a consumer to link their own dependencies have to run their own `npm run setup` once

### Fixed

- `symlinks` plugin deduplicating the peers of packages linked only into a workspace member, which were found once
  the package was first resolved and so stayed duplicated in the dependencies prebundled by the Vite optimizer

### Security

- `markdown-it` development dependency upgraded to 14.3.3, fixing GHSA-gfr2-rv44-r23c and GHSA-vfgh-jcmw-g37q;
  the package is used only to build the documentation, so consumers are not affected
- `vitest` development dependency upgraded to 4.1.12, fixing GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp; the
  package is used only to run the test suite and never reaches the published build, so consumers are not affected

## [0.5.0](https://github.com/metreeca/rack/compare/v0.4.0...v0.5.0) - 2026-10-14

### Changed

- `cp`, `ln` and `rm` prefix each path they print on stdout with the tool name, as in `cp src/index.css`, so a script
  log shows which command changed each path; scripts parsing the bare paths printed until 0.4 have to strip the prefix

### Fixed

- `symlinks` plugin sharing the peers of linked packages also with dependencies prebundled by the Vite optimizer, so a
  prebundled library no longer loads a second copy of a peer, such as Preact, next to the one the project resolves

## [0.4.0](https://github.com/metreeca/rack/compare/v0.3.0...v0.4.0) - 2026-10-14

### Added

- `symlinks` plugin sharing the `peerDependencies` of linked packages with the project, so the project and its linked
  packages load a single copy of each peer, such as Preact, without a hand-kept `resolve.dedupe` list

### Fixed

- `cp`, `ln` and `rm` commands kept executable when a linked Rack checkout is rebuilt, so the npm scripts of linked
  consumers no longer fall through to the system commands with the same name after `npm run build` in the checkout

## [0.3.0](https://github.com/metreeca/rack/compare/v0.2.0...v0.3.0) - 2026-10-14

### Added

- `cp`, `ln` and `rm` exported as functions from `@metreeca/rack/tool`, so build scripts can run the tools in process
  and handle their failures as thrown errors rather than as error messages and non-zero process exit statuses

### Changed

- `vite` peer dependency made optional, so projects using only the command line tools no longer have to install Vite;
  a project that does install it still needs Vite 8, which the `symlinks` plugin from `@metreeca/rack/vite` targets

## [0.2.0](https://github.com/metreeca/rack/compare/v0.1.0...v0.2.0) - 2026-10-14

### Added

- `symlinks` Vite plugin resolving imports of packages linked into `node_modules` to their TypeScript source, so tests
  run against the working tree of workspace members and sibling checkouts with no prior build
- `@metreeca/rack/tool` module for Unix-like command line tools behaving the same in npm scripts on every platform
  and listing the paths they act on, so that the script log shows what each command changed on disk
- `cp` command copying the files matched by glob patterns into a directory, keeping their relative layout
- `ln` command linking the local checkouts of dependencies into `node_modules`, along with the packages they depend
  on in turn, so the dependencies of a package or monorepo resolve to their working trees
- `rm` command removing the files and directories matched by glob patterns, with their content

### Changed

- Package scope widened from tooling for @metreeca packages to everyday tooling for npm package development

### Removed

- `@metreeca/rack` root entry point, which exported nothing: each tool is imported from the subpath of the toolchain
  it extends, such as `@metreeca/rack/vite`, so code importing the bare package name has to switch to that subpath

## [0.1.0](https://github.com/metreeca/rack/releases/tag/v0.1.0) - 2026-10-14

Initial release, establishing the package as the single maintained home for the build, test and documentation
tooling shared across @metreeca packages, with tools grouped by the toolchain they extend:

- `@metreeca/rack/vite` module for Vite plugins used to build and test @metreeca packages
