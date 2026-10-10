import fs from "fs";
import path from "path";
import * as log from "../logger.js";
import {
	resolveArtifactName,
	fileSize,
	parseBuildIgnore,
	bundleJS,
	compileSCSS,
	minifyCSS,
	applyReplacements,
	applyScriptReplacements,
	readBin,
	writeBin,
	IMAGE_EXTS,
	isScriptFile,
} from "../utils.js";
import { createSourceIndex, safeOutputPath } from "../src-resolver.js";
import { generateEnvReplacements } from "../env.js";
import type { Config } from "../types.js";

async function bundleBin(
	config: Config,
	opts: { outPath: string; isDev: boolean; silent: boolean },
): Promise<void> {
	const srcDir = config._srcDir;
	const ignoreRules = parseBuildIgnore(config._buildIgnore);
	const logFile: (action: string, name: string) => void = opts.silent
		? () => {}
		: (a, n) => log.file(a, n);

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

	const { shared } = index;
	const policy = { srcDir, allowedFiles: shared };

	const jsFiles: string[] = [];
	const cssChunks: string[] = [];
	const binJs: string[] = [];

	for (const srcFile of shared) {
		const ext = path.extname(srcFile).toLowerCase();
		if (IMAGE_EXTS.includes(ext)) continue;

		if (isScriptFile(srcFile)) {
			jsFiles.push(srcFile);
			logFile("minify", path.relative(srcDir, srcFile));
		} else if (ext === ".css") {
			let content = fs.readFileSync(srcFile, "utf8");
			content = applyReplacements(content, replacements);
			cssChunks.push((await minifyCSS(srcFile, content)).trim());
			logFile("minify", path.relative(srcDir, srcFile));
		} else if (ext === ".scss") {
			let content = fs.readFileSync(srcFile, "utf8");
			content = applyReplacements(content, replacements);
			cssChunks.push(
				(await compileSCSS(srcFile, content, policy)).trim(),
			);
			logFile("minify", path.relative(srcDir, srcFile));
		} else if (ext === ".bin") {
			const mod = readBin(srcFile);
			if (mod.css)
				cssChunks.unshift(
					applyReplacements(mod.css, replacements).trim(),
				);
			if (mod.js)
				binJs.push(applyScriptReplacements(mod.js, replacements));
			logFile("merge", path.relative(srcDir, srcFile));
		}
	}

	// .bin is always shipped minified — dev only affects env replacements.
	let jsOut =
		jsFiles.length > 0
			? await bundleJS(jsFiles, replacements, false, policy)
			: "";
	jsOut += binJs.join("");
	const cssOut = cssChunks.join("");

	if (!jsOut && !cssOut) {
		throw new Error("nothing to bundle: no styles or scripts found");
	}

	writeBin(opts.outPath, { css: cssOut, js: jsOut });
}

// Production build
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

// Dev build
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
