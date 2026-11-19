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
 * Module hooks loading the assets a package ships, such as stylesheets, as empty modules.
 *
 * Bundlers hand imported assets over to the bundle rather than to the module importing them, so a module importing
 * its own stylesheet runs in every consumer while plain Node rejects the import. Preloaded with `--import` by the
 * processes `ush qc` checks modules in, the hooks let such modules load as they do once bundled; an asset missing
 * from the package still fails to resolve, so it is reported as a broken import.
 *
 * @module
 */

import { registerHooks } from "node:module";


/**
 * The file URLs of assets: files with an extension other than the ones Node loads as modules.
 */
const Asset = /^file:.*\.(?!(?:[cm]?js|json|node|wasm)$)[^./]+$/;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

registerHooks({
	load: (url, context, next) => Asset.test(url)
		? { format: "module", source: "", shortCircuit: true }
		: next(url, context)
});
