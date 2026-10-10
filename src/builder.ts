import { buildNextMusic, buildNextMusicDev } from "./builders/nextmusic.js";
import { buildWeb } from "./builders/web.js";
import { buildBin, buildBinDev } from "./builders/bin.js";
import type { Config, Target } from "./types.js";
import { isTarget, TARGETS, TARGET_METADATA } from "./targets.js";

// Builder registry
const BUILDERS: Record<Target, (config: Config) => Promise<void>> = {
	nextmusic: buildNextMusic,
	web: buildWeb,
	bin: buildBin,
};

type DevTarget = {
	[T in Target]: (typeof TARGET_METADATA)[T]["dev"] extends true ? T : never;
}[Target];

const DEV_BUILDERS: Record<DevTarget, (config: Config) => Promise<void>> = {
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
	const builder = isTarget(key) ? BUILDERS[key] : undefined;
	if (!builder) {
		throw new Error(
			`Unknown target: "${pkg}". Available: ${TARGETS.join(", ")}`,
		);
	}
	await builder(config);
}

function isDevTarget(value: string): value is DevTarget {
	return isTarget(value) && TARGET_METADATA[value].dev;
}

// Dev build
export async function buildDevTarget(
	config: Config,
	target: string,
): Promise<void> {
	const key = target.toLowerCase();
	const builder = isDevTarget(key) ? DEV_BUILDERS[key] : undefined;
	if (!builder) {
		throw new Error(`Dev build not supported for target: "${target}"`);
	}
	await builder(config);
}
