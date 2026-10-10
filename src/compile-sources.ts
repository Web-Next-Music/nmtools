import fs from "fs";
import path from "path";
import {
	bundleJS,
	compileSCSS,
	minifyCSS,
	applyReplacements,
	applyScriptReplacements,
	isScriptFile,
	isTypeDeclaration,
} from "./compile.js";
import { readBin } from "./bin-format.js";
import { IMAGE_EXTS } from "./utils.js";
import type { Replacement } from "./types.js";

export interface CompileSourcesOptions {
	files: string[];
	srcDir: string;
	replacements: Replacement[];
	isDev?: boolean;
	logFile?: (action: string, name: string) => void;
	jsName?: string;
	cssName?: string;
}

// Preserve caller order, while keeping module CSS before source styles and
// module JS after the script bundle. Chunks remain separate for web styles.
export async function compileSources({
	files,
	srcDir,
	replacements,
	isDev = false,
	logFile = () => {},
	jsName,
	cssName,
}: CompileSourcesOptions): Promise<{
	js: string;
	hasJsOutput: boolean;
	cssChunks: string[];
	copyFiles: string[];
}> {
	const policy = { srcDir, allowedFiles: files };
	const scripts: string[] = [];
	const cssChunks: string[] = [];
	const binJs: string[] = [];
	const copyFiles: string[] = [];
	for (const file of files) {
		const ext = path.extname(file).toLowerCase();
		const relative = path.relative(srcDir, file);
		if (isTypeDeclaration(file)) continue;
		if (
			path.dirname(path.resolve(file)) === path.resolve(srcDir) &&
			/^(icon|banner)$/i.test(path.basename(file, ext)) &&
			IMAGE_EXTS.includes(ext)
		)
			continue;
		if (ext === ".bin") {
			const mod = readBin(file);
			if (mod.css)
				cssChunks.unshift(
					applyReplacements(mod.css, replacements).trim(),
				);
			if (mod.js)
				binJs.push(applyScriptReplacements(mod.js, replacements));
			logFile("merge", relative);
		} else if (isScriptFile(file)) {
			scripts.push(file);
			logFile("minify", relative + (jsName ? " → " + jsName : ""));
		} else if (ext === ".css" || ext === ".scss") {
			const content = applyReplacements(
				fs.readFileSync(file, "utf8"),
				replacements,
			);
			cssChunks.push(
				(ext === ".scss"
					? await compileSCSS(file, content, policy)
					: await minifyCSS(file, content)
				).trim(),
			);
			logFile("minify", relative + (cssName ? " → " + cssName : ""));
		} else copyFiles.push(file);
	}
	const js =
		(scripts.length
			? await bundleJS(scripts, replacements, isDev, policy)
			: "") + binJs.join("");
	return {
		js,
		hasJsOutput: scripts.length > 0 || binJs.length > 0,
		cssChunks,
		copyFiles,
	};
}
