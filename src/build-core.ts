import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import {
	ensureDir,
	IMAGE_EXTS,
	parseBuildIgnore,
	shouldIgnore,
	removeEmptyAssetsDir,
} from "./utils.js";
import {
	collectSourceFiles,
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
	copyMetadata?: boolean;
	isDev?: boolean;
}

export async function buildToDir(
	config: Config,
	opts: BuildOptions,
): Promise<void> {
	const srcDir = config._srcDir;
	const metadata = config._metadata;
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
	const { shared, targetSpecific, assets } = collectSourceFiles(
		srcDir,
		opts.targetFolder,
		ignoreRules,
		index,
	);
	const allFiles = [...targetSpecific, ...shared];

	ensureDir(opts.outDir);

	// Icon
	const brandingDir = path.join(srcDir, "assets", "branding");
	const findImageFile = (dir: string, name: string): string | undefined =>
		[...index.assets, ...index.shared].find(
			(file) =>
				path.resolve(path.dirname(file)) === path.resolve(dir) &&
				path.basename(file, path.extname(file)) === name &&
				IMAGE_EXTS.includes(path.extname(file).toLowerCase()),
		);
	const iconFile =
		findImageFile(brandingDir, "icon") ?? findImageFile(srcDir, "icon");
	if (iconFile) {
		const ext = path.extname(iconFile);
		fs.copyFileSync(iconFile, outputs.claim(`icon${ext}`, iconFile));
		logFile("copy", `icon${ext}`);
	} else {
		logWarn("No icon image found in assets/branding/ or src/");
	}

	// Banner
	const bannerFile =
		findImageFile(brandingDir, "banner") ?? findImageFile(srcDir, "banner");
	if (bannerFile) {
		const ext = path.extname(bannerFile);
		fs.copyFileSync(bannerFile, outputs.claim(`banner${ext}`, bannerFile));
		logFile("copy", `banner${ext}`);
	}

	// metadata.json
	if (opts.copyMetadata) {
		const metaSrc = path.join(srcDir, "metadata.json");
		if (index.shared.includes(metaSrc)) {
			fs.copyFileSync(metaSrc, outputs.claim("metadata.json", metaSrc));
			logFile("write", "metadata.json");
		} else {
			logWarn("metadata.json not found in src/");
		}
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
	if (assets.length > 0) logFile("copy", "assets/");

	// Bundle JS/CSS
	await bundleToDir(
		allFiles,
		srcDir,
		opts.targetFolder,
		opts.outDir,
		metadata,
		replacements,
		logFile,
		isDev,
		outputs,
	);

	// Cleanup
	removeEmptyAssetsDir(opts.outDir);
}
