import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { ArchiveEntry, TarEntry } from "./types.js";
import { ensureDir } from "./utils.js";
import { shouldIgnore } from "./ignore.js";

// TAR.GZ (pure Node.js)
function tarChecksum(block: Buffer): number {
	let sum = 0;
	for (let i = 0; i < 512; i++) {
		sum += i >= 148 && i < 156 ? 32 : block[i];
	}
	return sum;
}

function tarHeader(
	name: string,
	size: number,
	mtime: number,
	type: string,
	mode?: number,
): Buffer {
	const block = Buffer.alloc(512, 0);
	const write = (
		offset: number,
		len: number,
		value: string,
		encoding: BufferEncoding = "ascii",
	) => {
		const b = Buffer.from(value, encoding);
		b.copy(block, offset, 0, Math.min(b.length, len));
	};

	write(0, 100, name);
	write(
		100,
		8,
		(mode || (type === "5" ? 0o755 : 0o644)).toString(8).padStart(7, "0") +
			"\0",
	);
	write(108, 8, "0000000\0");
	write(116, 8, "0000000\0");
	write(124, 12, size.toString(8).padStart(11, "0") + "\0");
	write(
		136,
		12,
		Math.floor(mtime / 1000)
			.toString(8)
			.padStart(11, "0") + "\0",
	);
	write(148, 8, "        ");
	block[156] = type.charCodeAt(0);
	write(257, 6, "ustar\0");
	write(263, 2, "00");

	const sum = tarChecksum(block);
	write(148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
	return block;
}

function gnuLongNameBlocks(name: string, type: string): Buffer[] {
	const nameBytes = Buffer.from(name + "\0", "utf8");
	const header = tarHeader("././@LongLink", nameBytes.length, 0, type, 0);
	header[156] = type.charCodeAt(0);
	const sum = tarChecksum(header);
	Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(
		header,
		148,
	);

	const dataBlocks = Math.ceil(nameBytes.length / 512);
	const dataBuf = Buffer.alloc(dataBlocks * 512, 0);
	nameBytes.copy(dataBuf);
	return [header, dataBuf];
}

function collectTarEntries(
	diskPath: string,
	archiveName: string,
	result: TarEntry[] = [],
	ignoreRules: string[] = [],
): TarEntry[] {
	if (shouldIgnore(diskPath, ignoreRules)) return result;
	const stat = fs.statSync(diskPath);
	if (stat.isDirectory()) {
		const dirName = archiveName.endsWith("/")
			? archiveName
			: archiveName + "/";
		result.push({ disk: null, name: dirName, stat, type: "5" });
		for (const entry of fs.readdirSync(diskPath))
			collectTarEntries(
				path.join(diskPath, entry),
				archiveName + "/" + entry,
				result,
				ignoreRules,
			);
	} else {
		result.push({ disk: diskPath, name: archiveName, stat, type: "0" });
	}
	return result;
}

export function createTarGz(
	outputPath: string,
	entries: ArchiveEntry[],
	ignoreRules: string[] = [],
): void {
	ensureDir(path.dirname(outputPath));

	const tarEntries: TarEntry[] = [];
	for (const entry of entries)
		collectTarEntries(entry.disk, entry.archive, tarEntries, ignoreRules);

	const chunks: Buffer[] = [];

	for (const entry of tarEntries) {
		const nameBytes = Buffer.from(entry.name, "utf8");

		if (nameBytes.length > 99) {
			chunks.push(...gnuLongNameBlocks(entry.name, "L"));
		}

		if (entry.type === "5") {
			const truncName =
				entry.name.length > 99 ? entry.name.slice(-99) : entry.name;
			chunks.push(tarHeader(truncName, 0, entry.stat.mtimeMs, "5"));
		} else {
			const data = fs.readFileSync(entry.disk!);
			const truncName =
				entry.name.length > 99 ? entry.name.slice(-99) : entry.name;
			chunks.push(
				tarHeader(truncName, data.length, entry.stat.mtimeMs, "0"),
			);
			const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
			data.copy(padded);
			chunks.push(padded);
		}
	}

	chunks.push(Buffer.alloc(1024, 0));

	const tar = Buffer.concat(chunks);
	const gz = zlib.gzipSync(tar, { level: 9 });
	fs.writeFileSync(outputPath, gz);
}
