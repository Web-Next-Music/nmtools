import { createHash } from "crypto";
import fs from "fs";

export type StyleCacheEntry = {
	text: string;
	bytes: number;
	dependencies: { file: string; hash: string }[];
};
const styleCache = new Map<string, StyleCacheEntry>();
const MAX_STYLE_CACHE_ENTRIES = 64;
const MAX_STYLE_CACHE_BYTES = 4 * 1024 * 1024;
let styleCacheBytes = 0;

export function contentHash(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

function deleteStyleCacheEntry(key: string): void {
	const entry = styleCache.get(key);
	if (entry) {
		styleCacheBytes -= entry.bytes;
	}
	styleCache.delete(key);
}

export function getCachedStyle(key: string): string | undefined {
	const entry = styleCache.get(key);
	if (!entry) {
		return;
	}
	try {
		for (const dep of entry.dependencies) {
			if (contentHash(fs.readFileSync(dep.file)) !== dep.hash) {
				deleteStyleCacheEntry(key);
				return;
			}
		}
	} catch {
		deleteStyleCacheEntry(key);
		return;
	}
	styleCache.delete(key);
	styleCache.set(key, entry);
	return entry.text;
}

export function cacheStyle(
	key: string,
	text: string,
	dependencies: StyleCacheEntry["dependencies"] = [],
): void {
	deleteStyleCacheEntry(key);
	const bytes =
		Buffer.byteLength(text) +
		Buffer.byteLength(key) +
		dependencies.reduce(
			(sum, dep) => sum + Buffer.byteLength(dep.file) + dep.hash.length,
			0,
		);
	if (bytes > MAX_STYLE_CACHE_BYTES) {
		return;
	}
	while (
		styleCache.size >= MAX_STYLE_CACHE_ENTRIES ||
		styleCacheBytes + bytes > MAX_STYLE_CACHE_BYTES
	) {
		const oldestKey = styleCache.keys().next().value;
		if (oldestKey === undefined) {
			break;
		}
		deleteStyleCacheEntry(oldestKey);
	}
	styleCache.set(key, { text, bytes, dependencies });
	styleCacheBytes += bytes;
}
