import fs from "fs";
import { createRequire } from "module";
import path from "path";
import {
	objectSchema,
	parse,
	readProject,
	resolvePackage,
	resolveSourceDirectory,
	resolveTargets,
	validateTargetOptions,
} from "./config-validation.js";
import { loadEnvFile } from "./env.js";
import type { Config, ProjectConfig } from "./types.js";

const require = createRequire(import.meta.url);

function readBuildIgnore(cwd: string): string {
	const ignorePath = path.join(cwd, ".buildignore");
	return fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : "";
}

export function loadConfig(cwd = process.cwd()): Config {
	const projectDirectory = fs.realpathSync(path.resolve(cwd));
	const raw = readProject(projectDirectory);
	const build = parse(objectSchema("build"), raw.build);
	const targets = resolveTargets(build);
	const sourceDirectory = resolveSourceDirectory(projectDirectory, build);
	const { addonName, version } = resolvePackage(raw);
	validateTargetOptions(raw, { addonName, version });
	const project = { ...raw, build } as ProjectConfig;

	return {
		...project,
		addonName,
		version,
		_targets: targets,
		_cwd: projectDirectory,
		_env: loadEnvFile(projectDirectory),
		_version: (require("../package.json") as { version: string }).version,
		_srcDir: sourceDirectory,
		_buildIgnore: readBuildIgnore(projectDirectory),
	};
}
