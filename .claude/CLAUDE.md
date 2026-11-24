---
title: Project Guidelines
description: Development guidelines and conventions for the @grafctory/rack package.
---

# Foundational Package

> [!CAUTION]
> Rack sits at the bottom of the `@grafctory/*` dependency graph: every other package builds and tests through it,
> `@grafctory/core` included. It **MUST NOT** depend on any `@grafctory/*` package, at runtime or otherwise.

- **Release order**: a dependency on Core or any sibling closes a cycle, leaving the release chain with no valid order
- **Linked runs**: the `@grafctory/rack/node` hooks load before anything they resolve, so a sibling they imported would
  always run from its build, never from the linked checkout the hooks exist to serve
- **Helpers**: where Core already offers a helper, such as `unique()` from `@grafctory/core/arrays`, write a local
  equivalent instead of importing it; keep it minimal and private to the module that needs it

# CLI Tools

- **Synopses** passed as `help` to `cli()` follow GNU usage lines, as in `<target> <pattern>...` or `[<deps>]...`
- **Messages** follow the GNU Coding Standards for [`--help`][gnu-help] and [error messages][gnu-errors]

[gnu-help]: https://www.gnu.org/prep/standards/html_node/_002d_002dhelp.html

[gnu-errors]: https://www.gnu.org/prep/standards/html_node/Errors.html
