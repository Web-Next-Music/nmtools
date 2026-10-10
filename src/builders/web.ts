import fs from "fs";
import path from "path";
import * as log from "../logger.js";
import { ensureDir, fileSize } from "../utils.js";
import { resolveArtifactName, safeOutputPath } from "../paths.js";
import { parseBuildIgnore } from "../ignore.js";
import { compileSources } from "../compile-sources.js";
import { createSourceIndex, type SourceIndex } from "../src-resolver.js";
import { generateEnvReplacements } from "../env.js";
import type { Config, Replacement, TMUserScript } from "../types.js";

// Helpers

function fileToDataUrl(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const mimeMap: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
		".avif": "image/avif",
		".bmp": "image/bmp",
		".ico": "image/x-icon",
		".woff": "font/woff",
		".woff2": "font/woff2",
		".ttf": "font/ttf",
		".otf": "font/otf",
	};
	const mime = mimeMap[ext] || "application/octet-stream";
	const data = fs.readFileSync(filePath).toString("base64");
	return `data:${mime};base64,${data}`;
}

function createAssetLookup(
	index: SourceIndex,
	srcDir: string,
): Map<string, Set<string>> {
	const lookup = new Map<string, Set<string>>();
	for (const file of index.assets) {
		const relative = index.assetPaths.get(file)!.replace(/\\/g, "/");
		for (const key of [
			relative,
			"assets/" + relative,
			path.relative(srcDir, file).replace(/\\/g, "/"),
			path.basename(file),
		]) {
			if (!lookup.has(key)) lookup.set(key, new Set());
			lookup.get(key)!.add(file);
		}
	}
	return lookup;
}

function findAssetFile(
	lookup: Map<string, Set<string>>,
	srcDir: string,
	value: string,
): string | null {
	let clean = value.split(/[?#]/)[0].replace(/\\/g, "/");
	try {
		if (/^[a-z][a-z\d+.-]*:\/\//i.test(clean))
			clean = new URL(clean).pathname;
		clean = decodeURIComponent(clean);
	} catch {
		return null;
	}
	clean = clean.replace(/^\.\//, "").replace(/^\/+/, "");
	if (!clean || clean.split("/").includes("..")) return null;
	const marker = clean.lastIndexOf("/assets/");
	const candidates = [
		...(lookup.get(clean) ??
			(marker >= 0 ? lookup.get(clean.slice(marker + 1)) : undefined) ??
			lookup.get(path.posix.basename(clean)) ??
			[]),
	];
	if (candidates.length > 1)
		throw new Error(
			`Ambiguous asset reference "${value}": ${candidates.map((file) => path.relative(srcDir, file)).join(", ")}`,
		);
	return candidates[0] ?? null;
}

function buildWebReplacementMap(
	config: Config,
	index: SourceIndex,
): Replacement[] {
	const srcDir = config._srcDir;
	const assetsDir = path.join(srcDir, "assets");
	const replacements = config.web?.replaceLink ?? [];
	const map: Replacement[] = [];
	const lookup = createAssetLookup(index, srcDir);
	const dataUrls = new Map<string, string>();

	for (const item of replacements) {
		const from = item?.from;
		const to = item?.to;
		if (!from) continue;
		if (to !== undefined) {
			map.push({ from, to });
			continue;
		}

		const assetFile = findAssetFile(lookup, srcDir, from);
		if (!assetFile) {
			log.warn(`web replace skipped: asset not found - ${from}`);
			continue;
		}

		if (!dataUrls.has(assetFile))
			dataUrls.set(assetFile, fileToDataUrl(assetFile));
		map.push({ from, to: dataUrls.get(assetFile)! });
		log.file(
			"inline",
			`${from} → assets/${path.relative(assetsDir, assetFile)}`,
		);
	}

	return map;
}

function cssToJS(cssContent: string): string {
	return `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(cssContent)};document.head.appendChild(s)})();`;
}

function formatDirective(key: string, value: string): string {
	const spaces = Math.max(1, 14 - key.length);
	return `// @${key}${" ".repeat(spaces)}${value}`;
}

function buildTMHeader(metadata: Config["_metadata"], config: Config): string {
	const us: TMUserScript = config.web?.userscript ?? {};

	// Standard fields: userscript overrides metadata which overrides package.json
	const icon = (us.icon ?? config.web?.icon ?? "") as string;
	const name = (us.name ??
		metadata?.name ??
		config.addonName ??
		"Addon") as string;
	const namespace = (us.namespace ?? "nmtools") as string;
	const version = (us.version ??
		metadata?.version ??
		config.version ??
		"1.0.0") as string;
	const description = (us.description ??
		metadata?.description ??
		config.description ??
		"") as string;
	const authorValue = us.author ?? metadata?.author ?? config.author ?? "";
	const author = Array.isArray(authorValue)
		? authorValue.join(", ")
		: authorValue;

	const lines: string[] = ["// ==UserScript=="];

	function addDirective(
		key: string,
		val: string | string[] | boolean | undefined,
	): void {
		if (val === undefined || val === null) return;
		if (typeof val === "boolean") {
			if (val) lines.push(`// @${key}`);
			return;
		}
		const values = Array.isArray(val) ? val : [val];
		for (const v of values) {
			if (v !== "") lines.push(formatDirective(key, v));
		}
	}

	// Fixed-order standard fields
	addDirective("icon", icon);
	addDirective("name", name);
	addDirective("namespace", namespace);
	addDirective("version", version);
	addDirective("description", description);
	addDirective("author", author);
	addDirective("match", us.match ?? "https://music.yandex.ru/*");
	addDirective("grant", us.grant ?? "none");

	// All remaining userscript fields not already handled above
	const handled = new Set([
		"icon",
		"name",
		"namespace",
		"version",
		"description",
		"author",
		"match",
		"grant",
		"artifactName",
	]);
	for (const [key, val] of Object.entries(us)) {
		if (!handled.has(key)) addDirective(key, val);
	}

	lines.push("// ==/UserScript==");
	lines.push("");
	return lines.join("\n");
}

// Build

async function buildWebOnefile(config: Config): Promise<string> {
	const cwd = config._cwd;
	const srcDir = config._srcDir;
	const metadata = config._metadata;
	const index = createSourceIndex(
		srcDir,
		parseBuildIgnore(config._buildIgnore),
	);
	const webReplacements = buildWebReplacementMap(config, index);
	const onefileCfg = config.web?.onefile;

	if (onefileCfg) {
		log.warn(
			"web.onefile is deprecated - move artifactName into web.userscript.artifactName and use the web.userscript section instead",
		);
	}

	// Generate env-based replacements for production (only NMTOOLS_PUBLIC_)
	const envReplacements = generateEnvReplacements(config._env, false);

	// Combine web replacements with env replacements
	const replacements = [...webReplacements, ...envReplacements];

	const { js: jsBlock, cssChunks } = await compileSources({
		files: [...index.shared, ...index.targets.web],
		srcDir,
		replacements,
		logFile: log.file,
		cssName: "css-in-js",
	});
	const cssBlock = cssChunks.map(cssToJS).join("");

	const header = buildTMHeader(metadata, config);
	const body = `${cssBlock}${jsBlock}`.trim();
	const output = header + body + "\n";

	const rawArtifactName =
		config.web?.userscript?.artifactName ??
		onefileCfg?.artifactName ??
		"${addon.name}_${addon.version}_${build.package}.user.js";
	const artifactName = resolveArtifactName(rawArtifactName, config, "web");
	const outPath = safeOutputPath(path.join(cwd, "release"), artifactName);
	ensureDir(path.dirname(outPath));
	fs.writeFileSync(outPath, output, "utf8");
	log.artifact(artifactName, fileSize(outPath));
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
