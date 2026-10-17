import fs from "fs";
import { lookup as lookupMimeType } from "mime-types";
import path from "path";
import * as log from "../logger.js";
import type { SourceIndex } from "../src-resolver.js";
import type { Config, Replacement } from "../types.js";

function fileToDataUrl(filePath: string): string {
	const mime = lookupMimeType(filePath) || "application/octet-stream";
	const data = fs.readFileSync(filePath).toString("base64");
	return `data:${mime};base64,${data}`;
}

function getOrCreateSet(
	lookup: Map<string, Set<string>>,
	key: string,
): Set<string> {
	const existing = lookup.get(key);
	if (existing) {
		return existing;
	}
	const created = new Set<string>();
	lookup.set(key, created);
	return created;
}

function createAssetLookup(
	index: SourceIndex,
	srcDir: string,
): Map<string, Set<string>> {
	const lookup = new Map<string, Set<string>>();
	for (const file of index.assets) {
		const assetPath = index.assetPaths.get(file);
		if (assetPath === undefined) {
			throw new Error(`Missing indexed asset path: ${file}`);
		}
		const relative = assetPath.replace(/\\/g, "/");
		const keys = [
			relative,
			"assets/" + relative,
			path.relative(srcDir, file).replace(/\\/g, "/"),
			path.basename(file),
		];
		for (const key of keys) {
			getOrCreateSet(lookup, key).add(file);
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
		if (/^[a-z][a-z\d+.-]*:\/\//i.test(clean)) {
			clean = new URL(clean).pathname;
		}
		clean = decodeURIComponent(clean);
	} catch {
		return null;
	}
	clean = clean.replace(/^\.\//, "").replace(/^\/+/, "");
	if (!clean || clean.split("/").includes("..")) {
		return null;
	}
	const marker = clean.lastIndexOf("/assets/");
	const candidates = [
		...(lookup.get(clean) ??
			(marker >= 0 ? lookup.get(clean.slice(marker + 1)) : undefined) ??
			lookup.get(path.posix.basename(clean)) ??
			[]),
	];
	if (candidates.length > 1) {
		throw new Error(
			`Ambiguous asset reference "${value}": ${candidates.map((file) => path.relative(srcDir, file)).join(", ")}`,
		);
	}
	return candidates[0] ?? null;
}

export function buildWebReplacementMap(
	config: Config,
	index: SourceIndex,
): Replacement[] {
	const srcDir = config._srcDir;
	const assetsDir = path.join(srcDir, "assets");
	const replacements = config.web?.replaceLink ?? [];
	const replacementMap: Replacement[] = [];
	const lookup = createAssetLookup(index, srcDir);
	const dataUrls = new Map<string, string>();

	for (const replacement of replacements) {
		const from = replacement?.from;
		const to = replacement?.to;
		if (!from) {
			continue;
		}
		if (to !== undefined) {
			replacementMap.push({ from, to });
			continue;
		}

		const assetFile = findAssetFile(lookup, srcDir, from);
		if (!assetFile) {
			log.warn(`web replace skipped: asset not found - ${from}`);
			continue;
		}

		let dataUrl = dataUrls.get(assetFile);
		if (dataUrl === undefined) {
			dataUrl = fileToDataUrl(assetFile);
			dataUrls.set(assetFile, dataUrl);
		}
		replacementMap.push({ from, to: dataUrl });
		log.file(
			"inline",
			`${from} → assets/${path.relative(assetsDir, assetFile)}`,
		);
	}

	return replacementMap;
}
