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
 * A plugin created by this package, accepted wherever a Vite or Vitest configuration takes a `Plugin`.
 *
 * The type is spelled out in full rather than imported from Vite, so that a project type-checking a configuration
 * against a linked `@metreeca/rack` checkout loads the Vite and `@types/node` declarations it installs for itself
 * only, never a second copy from the checkout. Vite and Vitest configurations thus type-check against the same
 * declarations whether `@metreeca/rack` is installed from the registry or linked to a local checkout.
 */
export type Plugin = Readonly<{

	name: string
	enforce?: "pre" | "post"
	apply?: "serve" | "build"

	config?(config: Readonly<{ root?: string }>): Readonly<{ resolve: Readonly<{ dedupe: string[] }> }> // mutable: as Vite declares it

	configResolved?(config: Readonly<{ root: string, server: Readonly<{ fs: Readonly<{ allow: string[] }> }> }>): void // mutable: as Vite declares it

	configureServer?(server: Readonly<{
		config: Readonly<{
			server: Readonly<{
				middlewareMode: boolean | object
				proxy?: Readonly<Record<string, string | Readonly<{ target?: unknown }>>>
			}>
		}>
	}>): Promise<void>

	resolveId?(
		this: Readonly<{
			environment: Readonly<{ config: Readonly<{ root: string }> }>
			resolve(id: string, importer?: string, options?: Readonly<{ skipSelf?: boolean }>): Promise<Readonly<{
				id: string
			}> | null>
		}>,
		id: string,
		importer?: string
	): string | null | Promise<Readonly<{ id: string }> | null>

}>
