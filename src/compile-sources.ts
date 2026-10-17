import fs from "fs";
import path from "path";
import { readBin } from "./bin-format.js";
import {
	applyReplacements,
	applyScriptReplacements,
	bundleJS,
	compileSCSS,
	isScriptFile,
	isTypeDeclaration,
	minifyCSS,
} from "./compile.js";
import type { Replacement } from "./types.js";
import { IMAGE_EXTS } from "./utils.js";

export interface CompileSourcesOptions {
	files: string[];
	srcDir: string;
	replacements: Replacement[];
	isDev?: boolean;
	logFile?: (action: string, name: string) => void;
	jsName?: string;
	cssName?: string;
}

export interface CompileSourcesResult {
	js: string;
	hasJsOutput: boolean;
	cssChunks: string[];
	copyFiles: string[];
}

type SourceKind = "ignored" | "binary" | "script" | "style" | "asset";

function classifySource(file: string, srcDir: string): SourceKind {
	if (isTypeDeclaration(file)) {
		return "ignored";
	}
	const extension = path.extname(file).toLowerCase();
	const isRootBrandingImage =
		path.dirname(path.resolve(file)) === path.resolve(srcDir) &&
		/^(icon|banner)$/i.test(path.basename(file, extension)) &&
		IMAGE_EXTS.includes(extension);
	if (isRootBrandingImage) {
		return "ignored";
	}
	if (extension === ".bin") {
		return "binary";
	}
	if (isScriptFile(file)) {
		return "script";
	}
	if (extension === ".css" || extension === ".scss") {
		return "style";
	}
	return "asset";
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
}: CompileSourcesOptions): Promise<CompileSourcesResult> {
	const policy = { srcDir, allowedFiles: files };
	const scripts: string[] = [];
	const cssChunks: string[] = [];
	const binJs: string[] = [];
	const copyFiles: string[] = [];
	for (const file of files) {
		const extension = path.extname(file).toLowerCase();
		const relative = path.relative(srcDir, file);
		switch (classifySource(file, srcDir)) {
			case "ignored":
				continue;
			case "binary": {
				const module = readBin(file);
				if (module.css) {
					cssChunks.unshift(
						applyReplacements(module.css, replacements).trim(),
					);
				}
				if (module.js) {
					binJs.push(
						applyScriptReplacements(module.js, replacements),
					);
				}
				logFile("merge", relative);
				break;
			}
			case "script":
				scripts.push(file);
				logFile("minify", relative + (jsName ? " → " + jsName : ""));
				break;
			case "style": {
				const content = applyReplacements(
					fs.readFileSync(file, "utf8"),
					replacements,
				);
				const compiled =
					extension === ".scss"
						? await compileSCSS(file, content, policy)
						: await minifyCSS(file, content);
				cssChunks.push(compiled.trim());
				logFile("minify", relative + (cssName ? " → " + cssName : ""));
				break;
			}
			case "asset":
				copyFiles.push(file);
				break;
		}
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
