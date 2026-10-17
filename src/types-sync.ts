import fs from "fs";
import os from "os";
import path from "path";
import * as log from "./logger.js";

const TYPINGS_FILE = "nextmusic.d.ts";
const APP_DIR_NAMES = ["next-music", "Next Music"];

function appDataRoots(): string[] {
	const home = os.homedir();

	if (process.platform === "win32") {
		const appData =
			process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
		return [appData];
	}

	if (process.platform === "darwin") {
		return [path.join(home, "Library", "Application Support")];
	}

	return [process.env.XDG_CONFIG_HOME || path.join(home, ".config")];
}

export function findNextMusicTypings(): string | null {
	for (const root of appDataRoots()) {
		for (const appDir of APP_DIR_NAMES) {
			const candidate = path.join(root, appDir, "Addons", TYPINGS_FILE);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

export function syncTypes(cwd = process.cwd(), silent = false): boolean {
	const source = findNextMusicTypings();

	if (!source) {
		if (!silent) {
			log.warn(
				`${TYPINGS_FILE} not found. Install Next Music and launch it once, then run: nmtools types`,
			);
		}
		return false;
	}

	const targetDir = path.join(cwd, "types");
	const target = path.join(targetDir, TYPINGS_FILE);

	fs.mkdirSync(targetDir, { recursive: true });
	fs.copyFileSync(source, target);

	if (!silent) {
		log.file("write", path.join("types", TYPINGS_FILE));
	}
	return true;
}

export function runTypes(cwd = process.cwd()): void {
	log.task("types");
	syncTypes(cwd);
	log.done("types");
}
