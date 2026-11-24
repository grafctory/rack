# @grafctory/rack

[![npm](https://img.shields.io/npm/v/@grafctory/rack)](https://www.npmjs.com/package/@grafctory/rack)

Everyday tooling for npm package development.

**@grafctory/rack** collects build, test and documentation tooling for recurring npm package development needs, so each
package consumes a single maintained copy instead of carrying its own. Tools are grouped by the toolchain they extend:

| Subpath                     | Contents     |
|-----------------------------|--------------|
| [@grafctory/rack/tool][tool] | CLI tools    |
| [@grafctory/rack/node][node] | Node hooks   |
| [@grafctory/rack/vite][vite] | Vite plugins |

[tool]: https://grafctory.github.io/rack/modules/tool.html

[node]: https://grafctory.github.io/rack/modules/node.html

[vite]: https://grafctory.github.io/rack/modules/vite.html

# Installation

```shell
npm install --save-dev @grafctory/rack
```

> [!WARNING]
>
> TypeScript consumers must use `"moduleResolution": "nodenext"/"node16"/"bundler"` in `tsconfig.json`.
> The legacy `"node"` resolver is not supported.

# Support

- open an [issue](https://github.com/grafctory/rack/issues) to report a problem or to suggest a new feature
- start a [discussion](https://github.com/grafctory/rack/discussions) to ask a how-to question or to share an idea

# License

This project is licensed under the Apache 2.0 License –
see [LICENSE](https://github.com/grafctory/rack?tab=Apache-2.0-1-ov-file) file for details.
