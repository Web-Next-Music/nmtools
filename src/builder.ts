import { buildNextMusic, buildNextMusicDev } from "./builders/nextmusic.js";
import { buildWeb } from "./builders/web.js";
import { buildBin, buildBinDev } from "./builders/bin.js";
import type { Config } from "./types.js";

// Builder registry
const BUILDERS: Record<string, (config: Config) => Promise<void>> = {
	nextmusic: buildNextMusic,
	web: buildWeb,
	bin: buildBin,
};

const DEV_BUILDERS: Record<string, (config: Config) => Promise<void>> = {
	nextmusic: buildNextMusicDev,
	bin: buildBinDev,
};

// Production build
export async function buildAll(config: Config): Promise<void> {
	const targets = config._targets ?? [];
	if (targets.length === 0) {
		throw new Error("No targets defined in build.targets");
	}
	for (const t of targets) await buildPackage(config, t);
}

export async function buildPackage(config: Config, pkg: string): Promise<void> {
	const key = pkg.toLowerCase();
	const builder = Object.hasOwn(BUILDERS, key) ? BUILDERS[key] : undefined;
	if (!builder) {
		throw new Error(
			`Unknown target: "${pkg}". Available: ${Object.keys(BUILDERS).join(", ")}`,
		);
	}
	await builder(config);
}

// Dev build
export async function buildDevTarget(
	config: Config,
	target: string,
): Promise<void> {
	const key = target.toLowerCase();
	const builder = Object.hasOwn(DEV_BUILDERS, key)
		? DEV_BUILDERS[key]
		: undefined;
	if (!builder) {
		throw new Error(`Dev build not supported for target: "${target}"`);
	}
	await builder(config);
}
