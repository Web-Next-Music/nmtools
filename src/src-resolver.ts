import fs from "fs";
import path from "path";
import { safeOutputPath, OutputRegistry } from "./paths.js";
export { safeOutputPath, OutputRegistry } from "./paths.js";
import { TARGET_METADATA } from "./targets.js";
import { shouldIgnore } from "./ignore.js";
import { compileSources } from "./compile-sources.js";
import type { Metadata, Replacement } from "./types.js";

export const TARGET_FOLDERS = new Set<string>(
	Object.values(TARGET_METADATA)
		.map((target) => target.sourceFolder)
		.filter((folder) => folder !== null),
);

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

export interface SourceIndex {
	shared: string[];
	targets: Record<string, string[]>;
	assets: string[];
	assetPaths: Map<string, string>;
	targetDirs: string[];
}

// A reserved directory establishes a boundary; nested reserved directories never
// leak back into shared sources or into a different target.
export function createSourceIndex(
	srcDir: string,
	ignoreRules: string[] = [],
): SourceIndex {
	const index: SourceIndex = {
		shared: [],
		targets: Object.fromEntries(
			[...TARGET_FOLDERS].map((folder) => [folder, [] as string[]]),
		),
		assets: [],
		assetPaths: new Map(),
		targetDirs: [],
	};
	function walk(dir: string, scope = "shared", assetRoot = ""): void {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs
			.readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, entry.name);
			if (shouldIgnore(full, ignoreRules)) continue;
			if (entry.isDirectory()) {
				if (IGNORED_DIRS.has(entry.name)) continue;
				if (scope === "assets") {
					walk(full, scope, assetRoot);
					continue;
				}
				if (TARGET_FOLDERS.has(entry.name)) {
					index.targetDirs.push(full);
					if (scope === "shared") walk(full, entry.name);
					continue;
				}
				if (entry.name === "assets") {
					if (scope === "shared") walk(full, "assets", full);
					continue;
				}
				walk(full, scope, assetRoot);
			} else if (entry.isFile()) {
				if (scope === "assets") {
					index.assets.push(full);
					index.assetPaths.set(full, path.relative(assetRoot, full));
				} else if (scope === "shared") index.shared.push(full);
				else index.targets[scope].push(full);
			}
		}
	}
	walk(srcDir);
	return index;
}

export function copyAssetsToOut(
	srcDir: string,
	outDir: string,
	ignoreRules: string[] = [],
	index = createSourceIndex(srcDir, ignoreRules),
	outputs = new OutputRegistry(outDir),
): void {
	for (const file of index.assets) {
		const relative = index.assetPaths.get(file)!;
		if (relative.replace(/\\/g, "/").startsWith("branding/")) continue;
		fs.copyFileSync(file, outputs.claim("assets/" + relative, file));
	}
}

// Bundle name resolution
export function getBundleNames(metadata: Metadata | null): {
	js: string;
	css: string;
} {
	return {
		js: metadata?.script ?? "script.js",
		css: metadata?.css ?? "style.css",
	};
}

// Bundler
export interface BundleToDirOptions {
	allFiles: string[];
	srcDir: string;
	targetFolder: string;
	outDir: string;
	metadata: Metadata | null;
	replacements: Replacement[];
	logFile: (action: string, name: string) => void;
	isDev?: boolean;
	outputs?: OutputRegistry;
}

export async function bundleToDir({
	allFiles,
	srcDir,
	targetFolder,
	outDir,
	metadata,
	replacements,
	logFile,
	isDev = false,
	outputs = new OutputRegistry(outDir),
}: BundleToDirOptions): Promise<void> {
	const { js: jsName, css: cssName } = getBundleNames(metadata);
	const { js, hasJsOutput, cssChunks, copyFiles } = await compileSources({
		files: allFiles,
		srcDir,
		replacements,
		logFile,
		isDev,
		jsName,
		cssName,
	});
	for (const file of copyFiles) {
		const relative = relativeOutputPath(file, srcDir, targetFolder);
		fs.copyFileSync(file, outputs.claim(relative, file));
		logFile("copy", relative);
	}
	if (hasJsOutput) {
		fs.writeFileSync(outputs.claim(jsName, "JS bundle"), js, "utf8");
		logFile("write", jsName);
	}
	if (cssChunks.length) {
		fs.writeFileSync(
			outputs.claim(cssName, "CSS bundle"),
			cssChunks.join(""),
			"utf8",
		);
		logFile("write", cssName);
	}
}

// Helpers
export function relativeOutputPath(
	filePath: string,
	srcDir: string,
	targetFolder: string,
): string {
	const relative = path.relative(
		path.resolve(srcDir),
		path.resolve(filePath),
	);
	safeOutputPath(srcDir, relative);
	const parts = relative.split(path.sep);
	const targetIndex = parts.indexOf(targetFolder);
	if (TARGET_FOLDERS.has(targetFolder) && targetIndex !== -1)
		parts.splice(targetIndex, 1);
	return parts.join(path.sep);
}
