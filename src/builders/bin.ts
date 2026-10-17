import path from "path";
import { writeBin } from "../bin-format.js";
import { compileSources } from "../compile-sources.js";
import { generateEnvReplacements } from "../env.js";
import { parseBuildIgnore } from "../ignore.js";
import * as log from "../logger.js";
import { resolveArtifactName, safeOutputPath } from "../paths.js";
import { createSourceIndex } from "../src-resolver.js";
import type { Config } from "../types.js";
import { fileSize } from "../utils.js";

async function bundleBin(
	config: Config,
	opts: { outPath: string; isDev: boolean; silent: boolean },
): Promise<void> {
	const srcDir = config._srcDir;
	const ignoreRules = parseBuildIgnore(config._buildIgnore);
	const logFile: (action: string, name: string) => void = opts.silent
		? () => {}
		: (action, name) => log.file(action, name);

	const index = createSourceIndex(srcDir, ignoreRules);
	if (index.targetDirs.length > 0) {
		throw new Error(
			`bin build does not support target folders (web/nm): ${index.targetDirs.join(", ")}`,
		);
	}

	const replacements = [
		...(config.web?.replaceLink ?? []),
		...generateEnvReplacements(config._env, opts.isDev),
	];

	// Dev affects replacements only: bin scripts are always minified.
	const { js: jsOut, cssChunks } = await compileSources({
		files: index.shared,
		srcDir,
		replacements,
		logFile,
		isDev: false,
	});
	const cssOut = cssChunks.join("");

	if (!jsOut && !cssOut) {
		throw new Error("nothing to bundle: no styles or scripts found");
	}

	writeBin(opts.outPath, { css: cssOut, js: jsOut });
}

export async function buildBin(config: Config): Promise<void> {
	const cwd = config._cwd;
	const name = config.addonName;
	const version = config.version;

	log.task("bin");
	log.info("building", { target: "bin", addonName: name, version });

	const artifactName = resolveArtifactName(
		config.bin?.artifactName ?? "${addon.name}_${addon.version}.bin",
		config,
		"bin",
	);
	const outPath = safeOutputPath(path.join(cwd, "release"), artifactName);

	await bundleBin(config, {
		outPath,
		isDev: false,
		silent: false,
	});

	log.artifact(artifactName, fileSize(outPath));
	log.done("bin", artifactName);
}

export async function buildBinDev(config: Config): Promise<void> {
	const artifactName = resolveArtifactName(
		config.bin?.artifactName ?? "${addon.name}_${addon.version}.bin",
		config,
		"bin",
	);
	const outPath = safeOutputPath(
		path.join(config._cwd, "dist"),
		artifactName,
	);

	await bundleBin(config, { outPath, isDev: true, silent: true });
}
