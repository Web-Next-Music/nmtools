import fs from "fs";
import path from "path";
import zlib from "zlib";
import { ensureDir } from "./utils.js";

// .bin module container (magic-prefixed, gzip-compressed binary).
// Keep the original format signature for compatibility with existing modules.
const BIN_MAGIC = Buffer.from("YMTM", "ascii");
const BIN_VERSION = 1;
// Bound both compressed input and decompressed output to limit gzip bombs.
const MAX_BIN_SIZE = 64 * 1024 * 1024;

export function writeBin(
	filePath: string,
	data: { css: string; js: string },
): void {
	if (
		13 + Buffer.byteLength(data.css) + Buffer.byteLength(data.js) >
		MAX_BIN_SIZE
	) {
		throw new Error(`.bin module exceeds size limit: ${filePath}`);
	}
	const css = Buffer.from(data.css, "utf8");
	const js = Buffer.from(data.js, "utf8");

	const header = Buffer.alloc(13);
	BIN_MAGIC.copy(header, 0);
	header.writeUInt8(BIN_VERSION, 4);
	header.writeUInt32LE(css.length, 5);
	header.writeUInt32LE(js.length, 9);

	const payload = zlib.gzipSync(Buffer.concat([header, css, js]), {
		level: 9,
	});
	if (payload.length > MAX_BIN_SIZE) {
		throw new Error(
			`Compressed .bin module exceeds size limit: ${filePath}`,
		);
	}
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, payload);
}

export function readBin(filePath: string): { css: string; js: string } {
	if (fs.statSync(filePath).size > MAX_BIN_SIZE) {
		throw new Error(`.bin module exceeds size limit: ${filePath}`);
	}
	const compressed = fs.readFileSync(filePath);
	if (compressed.length > MAX_BIN_SIZE) {
		throw new Error(`.bin module exceeds size limit: ${filePath}`);
	}
	const buf = zlib.gunzipSync(compressed, { maxOutputLength: MAX_BIN_SIZE });

	if (buf.length < 13 || !buf.subarray(0, 4).equals(BIN_MAGIC)) {
		throw new Error(`Not a valid .bin module: ${filePath}`);
	}

	if (buf.readUInt8(4) !== BIN_VERSION) {
		throw new Error(`Unsupported .bin module version: ${filePath}`);
	}

	const cssLen = buf.readUInt32LE(5);
	const jsLen = buf.readUInt32LE(9);
	const cssStart = 13;
	const jsStart = cssStart + cssLen;
	if (jsStart + jsLen !== buf.length) {
		throw new Error(`Invalid .bin module payload length: ${filePath}`);
	}

	return {
		css: buf.toString("utf8", cssStart, jsStart),
		js: buf.toString("utf8", jsStart, jsStart + jsLen),
	};
}
