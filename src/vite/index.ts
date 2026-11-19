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
 * Vite plugins for developing, building and testing npm packages and the web clients built on them.
 *
 * | Plugin           | Purpose                                                                         |
 * |------------------|---------------------------------------------------------------------------------|
 * | {@link symlinks} | Runs tests against the live source of locally linked packages, with no rebuild |
 * | {@link backend}  | Holds the dev server back until the backends it proxies to accept connections  |
 *
 * @module
 */

export { backend } from "./backend.js";
export type { Plugin } from "./plugin.js";
export { symlinks } from "./symlinks.js";
