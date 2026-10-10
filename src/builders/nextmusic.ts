import fs from "fs";
import path from "path";
import * as log from "../logger.js";
import {
	createTarGz,
	resolveArtifactName,
	addonFolderName,
	fileSize,
} from "../utils.js";
import { buildToDir } from "../build-core.js";
import { safeOutputPath } from "../src-resolver.js";
import type { Config } from "../types.js";

// Production build
export async function buildNextMusic(config: Config): Promise<void> {
	const cwd = config._cwd;
	const name = config.addonName;
	const version = config.version;

	log.task("nextmusic");
	log.info("building", { target: "nextmusic", addonName: name, version });

	const unpackedFolder = addonFolderName(name, version) + "_nm-unpacked";
	const unpackedDir = safeOutputPath(
		path.join(cwd, "release"),
		unpackedFolder,
	);
	const outDir = safeOutputPath(unpackedDir, name);
	fs.rmSync(unpackedDir, { recursive: true, force: true });

	await buildToDir(config, {
		targetFolder: "nm",
		outDir,
		copyMetadata: true,
		copyLicense: true,
	});

	const tarGzConfig = config.nextmusic?.tarGz;

	if (tarGzConfig) {
		const tarGzName = resolveArtifactName(
			tarGzConfig.artifactName,
			config,
			"nextmusic",
		);
		const tarGzPath = safeOutputPath(path.join(cwd, "release"), tarGzName);
		createTarGz(tarGzPath, [{ disk: outDir, archive: name }]);
		log.artifact(tarGzName, fileSize(tarGzPath));
		log.done("nextmusic", tarGzName);
	} else {
		log.done("nextmusic");
	}
}

// Dev build
export async function buildNextMusicDev(config: Config): Promise<void> {
	const outDir = safeOutputPath(
		path.join(config._cwd, "dist"),
		config.addonName,
	);
	if (fs.existsSync(outDir))
		fs.rmSync(outDir, { recursive: true, force: true });
	await buildToDir(config, {
		targetFolder: "nm",
		outDir,
		silent: true,
		isDev: true,
		copyMetadata: true,
		copyLicense: true,
	});
}
