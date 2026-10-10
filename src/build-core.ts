import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { ensureDir, IMAGE_EXTS, removeEmptyAssetsDir } from "./utils.js";
import { parseBuildIgnore, shouldIgnore } from "./ignore.js";
import {
	createSourceIndex,
	OutputRegistry,
	copyAssetsToOut,
	bundleToDir,
} from "./src-resolver.js";
import { generateEnvReplacements } from "./env.js";
import type { Config } from "./types.js";

// Public API
export interface BuildOptions {
	targetFolder: string;
	outDir: string;
	silent?: boolean;
	copyLicense?: boolean;
	copyPackage?: boolean;
	isDev?: boolean;
}

export async function buildToDir(
	config: Config,
	opts: BuildOptions,
): Promise<void> {
	const srcDir = config._srcDir;
	const webReplacements = config.web?.replaceLink ?? [];
	const ignoreRules = parseBuildIgnore(config._buildIgnore);
	const silent = opts.silent ?? false;
	const isDev = opts.isDev ?? false;

	// Generate env-based replacements
	const envReplacements = generateEnvReplacements(config._env, isDev);

	// Combine web replacements with env replacements
	const replacements = [...webReplacements, ...envReplacements];

	const noop = () => {};

	const logFile: (action: string, name: string) => void = silent
		? noop
		: (a, n) => log.file(a, n);
	const logWarn: (msg: string) => void = silent ? noop : log.warn;

	const index = createSourceIndex(srcDir, ignoreRules);
	const outputs = new OutputRegistry(opts.outDir);
	const allFiles = [
		...(index.targets[opts.targetFolder] ?? []),
		...index.shared,
	];
	ensureDir(opts.outDir);
	const brandingDir = path.join(srcDir, "assets", "branding");
	const findImageFile = (dir: string, name: string): string | undefined =>
		[...index.assets, ...index.shared].find(
			(file) =>
				path.resolve(path.dirname(file)) === path.resolve(dir) &&
				path.basename(file, path.extname(file)) === name &&
				IMAGE_EXTS.includes(path.extname(file).toLowerCase()),
		);
	for (const name of ["icon", "banner"]) {
		const file =
			findImageFile(brandingDir, name) ?? findImageFile(srcDir, name);
		if (file) {
			const destination = name + path.extname(file);
			fs.copyFileSync(file, outputs.claim(destination, file));
			logFile("copy", destination);
		} else if (name === "icon")
			logWarn("No icon image found in assets/branding/ or src/");
	}

	// Theme manifest
	if (opts.copyPackage) {
		const packageSrc = path.join(config._cwd, "package.json");
		fs.copyFileSync(packageSrc, outputs.claim("package.json", packageSrc));
		logFile("copy", "package.json");
	}

	// LICENSE
	if (opts.copyLicense) {
		const licenseSrc = path.join(config._cwd, "LICENSE");
		if (
			fs.existsSync(licenseSrc) &&
			!shouldIgnore(licenseSrc, ignoreRules)
		) {
			fs.copyFileSync(licenseSrc, outputs.claim("LICENSE", licenseSrc));
			logFile("copy", "LICENSE");
		} else {
			logWarn("LICENSE not found or excluded by .buildignore");
		}
	}

	// Assets
	copyAssetsToOut(srcDir, opts.outDir, ignoreRules, index, outputs);
	if (index.assets.length > 0) logFile("copy", "assets/");

	// Bundle JS/CSS
	await bundleToDir({
		allFiles,
		srcDir,
		targetFolder: opts.targetFolder,
		outDir: opts.outDir,
		replacements,
		logFile,
		isDev,
		outputs,
	});

	// Cleanup
	removeEmptyAssetsDir(opts.outDir);
}
