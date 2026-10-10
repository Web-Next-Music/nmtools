import path from "path";
import { create } from "tar";
import type { WriteEntry } from "tar";
import type { ArchiveEntry } from "./types.js";
import { ensureDir } from "./utils.js";
import { shouldIgnore } from "./ignore.js";

interface ResolvedArchiveEntry extends ArchiveEntry {
	disk: string;
	source: string;
}

function commonParent(paths: string[]): string {
	let parent = path.dirname(paths[0]);
	for (const diskPath of paths.slice(1)) {
		while (diskPath !== parent && !diskPath.startsWith(parent + path.sep)) {
			const next = path.dirname(parent);
			if (next === parent) break;
			parent = next;
		}
	}
	return parent;
}

function normaliseArchivePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

export function createTarGz(
	outputPath: string,
	entries: ArchiveEntry[],
	ignoreRules: string[] = [],
): void {
	if (entries.length === 0)
		throw new TypeError("no paths specified to add to archive");

	ensureDir(path.dirname(outputPath));
	const disks = entries.map((entry) => path.resolve(entry.disk));
	const cwd = commonParent(disks);
	const resolved: ResolvedArchiveEntry[] = entries.map((entry, index) => ({
		...entry,
		disk: disks[index],
		source: normaliseArchivePath(path.relative(cwd, disks[index])),
	}));

	create(
		{
			cwd,
			file: outputPath,
			gzip: { level: 9 },
			sync: true,
			filter: (entryPath) =>
				!shouldIgnore(path.resolve(cwd, entryPath), ignoreRules),
			onWriteEntry: (tarEntry: WriteEntry) => {
				const sourcePath = normaliseArchivePath(tarEntry.path);
				const mapping = resolved.find(
					(entry) =>
						sourcePath === entry.source ||
						sourcePath.startsWith(entry.source + "/"),
				);
				if (!mapping) return;
				const suffix = sourcePath.slice(mapping.source.length);
				tarEntry.path = normaliseArchivePath(mapping.archive) + suffix;
			},
		},
		resolved.map((entry) => entry.source),
	);
}
