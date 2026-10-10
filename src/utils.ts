import fs from "fs";
import path from "path";

export * from "./ignore.js";
export * from "./compile.js";
export { resolveArtifactName, addonFolderName } from "./paths.js";

export function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}
export const IMAGE_EXTS = [
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".svg",
	".ico",
	".bmp",
	".tiff",
];
export function fileSize(filePath: string): string {
	try {
		const bytes = fs.statSync(filePath).size;
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	} catch {
		return "";
	}
}

export function removeEmptyAssetsDir(outDir: string): void {
	const assetsDir = path.join(outDir, "assets");
	if (!fs.existsSync(assetsDir)) return;

	try {
		const entries = fs.readdirSync(assetsDir);
		if (entries.length === 0) {
			fs.rmSync(assetsDir, { recursive: true, force: true });
		}
	} catch {}
}
