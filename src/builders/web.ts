import fs from "fs";
import path from "path";
import { compileSources } from "../compile-sources.js";
import { generateEnvReplacements } from "../env.js";
import { parseBuildIgnore } from "../ignore.js";
import * as log from "../logger.js";
import { resolveArtifactName, safeOutputPath } from "../paths.js";
import { createSourceIndex } from "../src-resolver.js";
import type { Config } from "../types.js";
import { ensureDir, fileSize } from "../utils.js";
import { buildUserscriptHeader } from "./userscript-header.js";
import { buildWebReplacementMap } from "./web-assets.js";

function cssToJS(cssContent: string): string {
	return `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(cssContent)};document.head.appendChild(s)})();`;
}

async function buildWebOnefile(config: Config): Promise<string> {
	const cwd = config._cwd;
	const srcDir = config._srcDir;
	const index = createSourceIndex(
		srcDir,
		parseBuildIgnore(config._buildIgnore),
	);
	const webReplacements = buildWebReplacementMap(config, index);
	const onefileConfig = config.web?.onefile;

	if (onefileConfig) {
		log.warn(
			"web.onefile is deprecated - move artifactName into web.userscript.artifactName and use the web.userscript section instead",
		);
	}

	const envReplacements = generateEnvReplacements(config._env, false);
	const replacements = [...webReplacements, ...envReplacements];
	const { js: jsBlock, cssChunks } = await compileSources({
		files: [...index.shared, ...index.targets.web],
		srcDir,
		replacements,
		logFile: log.file,
		cssName: "css-in-js",
	});
	const cssBlock = cssChunks.map(cssToJS).join("");
	const header = buildUserscriptHeader(config);
	const body = `${cssBlock}${jsBlock}`.trim();
	const output = header + body + "\n";

	const rawArtifactName =
		config.web?.userscript?.artifactName ??
		onefileConfig?.artifactName ??
		"${addon.name}_${addon.version}_${build.package}.user.js";
	const artifactName = resolveArtifactName(rawArtifactName, config, "web");
	const outputPath = safeOutputPath(path.join(cwd, "release"), artifactName);
	ensureDir(path.dirname(outputPath));
	fs.writeFileSync(outputPath, output, "utf8");
	log.artifact(artifactName, fileSize(outputPath));
	return artifactName;
}

export async function buildWeb(config: Config): Promise<void> {
	log.task("web");
	log.info("building", {
		target: "web",
		addonName: config.addonName,
		version: config.version,
	});

	const artifactName = await buildWebOnefile(config);
	log.done("web", artifactName || undefined);
}
