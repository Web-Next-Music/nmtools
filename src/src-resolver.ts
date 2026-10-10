import fs from "fs";
import path from "path";
import {
	ensureDir,
	shouldIgnore,
	IMAGE_EXTS,
	bundleJS,
	compileSCSS,
	minifyCSS,
	applyReplacements,
	applyScriptReplacements,
	readBin,
	isScriptFile,
	isTypeDeclaration,
} from "./utils.js";
import type { Metadata, Replacement } from "./types.js";

export const TARGET_FOLDERS = new Set(["nm", "web"]);

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
		targets: { nm: [], web: [] },
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

export function collectSourceFiles(
	srcDir: string,
	targetFolder: string,
	ignoreRules: string[] = [],
	index = createSourceIndex(srcDir, ignoreRules),
): { shared: string[]; targetSpecific: string[]; assets: string[] } {
	return {
		shared: index.shared,
		targetSpecific: index.targets[targetFolder] ?? [],
		assets: index.assets,
	};
}

export function safeOutputPath(outDir: string, relative: string): string {
	const normalized = relative.replace(/\\/g, "/");
	if (
		!normalized ||
		path.posix.isAbsolute(normalized) ||
		/^[a-z]:/i.test(normalized) ||
		normalized.split("/").includes("..") ||
		normalized.includes("\0")
	)
		throw new Error(`Unsafe output path: ${relative}`);
	const root = path.resolve(outDir);
	const dest = path.resolve(root, normalized);
	if (dest === root || !dest.startsWith(root + path.sep))
		throw new Error(`Unsafe output path: ${relative}`);
	// Existing symlinks must not redirect writes outside the output tree.
	let current = dest;
	while (true) {
		let stat: fs.Stats | undefined;
		try {
			stat = fs.lstatSync(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (stat?.isSymbolicLink())
			throw new Error(`Symlink in output path: ${current}`);
		if (current === root) break;
		current = path.dirname(current);
	}
	return dest;
}

export class OutputRegistry {
	private destinations = new Map<string, string>();
	private directories = new Map<string, string>();
	constructor(private outDir: string) {}
	claim(relative: string, source: string): string {
		const dest = safeOutputPath(this.outDir, relative);
		const root = path.resolve(this.outDir);
		let owner = this.destinations.get(dest) ?? this.directories.get(dest);
		for (
			let parent = path.dirname(dest);
			parent !== root;
			parent = path.dirname(parent)
		)
			owner ??= this.destinations.get(parent);
		if (owner !== undefined)
			throw new Error(
				`Output collision: ${source} and ${owner} → ${relative}`,
			);
		this.destinations.set(dest, source);
		for (
			let parent = path.dirname(dest);
			parent !== root;
			parent = path.dirname(parent)
		)
			if (!this.directories.has(parent))
				this.directories.set(parent, source);
		ensureDir(path.dirname(dest));
		return dest;
	}
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
export async function bundleToDir(
	allFiles: string[],
	srcDir: string,
	targetFolder: string,
	outDir: string,
	metadata: Metadata | null,
	replacements: Replacement[],
	logFile: (action: string, name: string) => void,
	isDev = false,
	outputs = new OutputRegistry(outDir),
): Promise<void> {
	const { js: jsName, css: cssName } = getBundleNames(metadata);
	const policy = { srcDir, allowedFiles: allFiles };

	const jsFiles: string[] = [];
	const cssChunks: string[] = [];
	const binJs: string[] = [];

	for (const srcFile of allFiles) {
		const ext = path.extname(srcFile).toLowerCase();

		if (path.basename(srcFile) === "metadata.json") continue;
		if (
			path.dirname(path.resolve(srcFile)) === path.resolve(srcDir) &&
			/^(icon|banner)$/i.test(path.basename(srcFile, ext)) &&
			IMAGE_EXTS.includes(ext)
		)
			continue;
		if (isTypeDeclaration(srcFile)) continue;

		if (ext === ".bin") {
			const mod = readBin(srcFile);
			if (mod.css)
				cssChunks.unshift(
					applyReplacements(mod.css, replacements).trim(),
				);
			if (mod.js)
				binJs.push(applyScriptReplacements(mod.js, replacements));
			logFile("merge", path.relative(srcDir, srcFile));
			continue;
		}

		if (isScriptFile(srcFile)) {
			jsFiles.push(srcFile);
			logFile("minify", path.relative(srcDir, srcFile) + " → " + jsName);
		}

		if (ext === ".css") {
			let content = fs.readFileSync(srcFile, "utf8");
			content = applyReplacements(content, replacements);
			cssChunks.push((await minifyCSS(srcFile, content)).trim());
			logFile("minify", path.relative(srcDir, srcFile) + " → " + cssName);
		}

		if (ext === ".scss") {
			let content = fs.readFileSync(srcFile, "utf8");
			content = applyReplacements(content, replacements);
			cssChunks.push(
				(await compileSCSS(srcFile, content, policy)).trim(),
			);
			logFile("minify", path.relative(srcDir, srcFile) + " → " + cssName);
		}

		if (IMAGE_EXTS.includes(ext)) {
			const dest = outputs.claim(
				relativeOutputPath(srcFile, srcDir, targetFolder),
				srcFile,
			);
			ensureDir(path.dirname(dest));
			fs.copyFileSync(srcFile, dest);
			logFile("copy", path.relative(srcDir, srcFile));
		} else if (
			!isScriptFile(srcFile) &&
			ext !== ".css" &&
			ext !== ".scss"
		) {
			const rel = relativeOutputPath(srcFile, srcDir, targetFolder);
			const dest = outputs.claim(rel, srcFile);
			ensureDir(path.dirname(dest));
			fs.copyFileSync(srcFile, dest);
			logFile("copy", rel);
		}
	}

	if (jsFiles.length > 0 || binJs.length > 0) {
		ensureDir(outDir);
		const bundled =
			(jsFiles.length > 0
				? await bundleJS(jsFiles, replacements, isDev, policy)
				: "") + binJs.join("");
		fs.writeFileSync(outputs.claim(jsName, "JS bundle"), bundled, "utf8");
		logFile("write", jsName);
	}

	if (cssChunks.length > 0) {
		ensureDir(outDir);
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
