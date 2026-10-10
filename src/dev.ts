import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { loadConfig } from "./config.js";
import { buildDevTarget } from "./builder.js";
import type { Config } from "./types.js";

const TARGET_DISPLAY: Record<string, string> = {
	nextmusic: "Next Music",
	pulsesync: "PulseSync",
	bin: "Module (.bin)",
};

function displayName(target: string): string {
	return TARGET_DISPLAY[target] ?? target;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const CLEAR_LINE = "\x1b[2K\x1b[1G";

function prompt(question: string, choices: string[]): Promise<string> {
	return new Promise((resolve) => {
		let selected = 0;
		let drawn = false;

		function render(): void {
			if (drawn) {
				process.stdout.write(`\x1b[${choices.length}A`);
			}
			drawn = true;

			for (let i = 0; i < choices.length; i++) {
				const label = displayName(choices[i]);
				if (i === selected) {
					process.stdout.write(
						`${CLEAR_LINE}  ${CYAN}> ${label}${RESET}\n`,
					);
				} else {
					process.stdout.write(`${CLEAR_LINE}    ${label}\n`);
				}
			}
		}

		process.stdout.write(`\n  ${question}\n\n`);
		render();

		const stdin = process.stdin;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		function cleanup(): void {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.removeListener("data", onData);
		}

		function onData(key: string): void {
			if (key === "\u0003") {
				cleanup();
				process.stdout.write("\n");
				process.exit(0);
			}

			if (key === "\r" || key === "\n") {
				cleanup();
				process.stdout.write("\n");
				resolve(choices[selected]);
				return;
			}

			if (key === "\x1b[A") {
				selected = (selected - 1 + choices.length) % choices.length;
				render();
				return;
			}

			if (key === "\x1b[B") {
				selected = (selected + 1) % choices.length;
				render();
				return;
			}
		}

		stdin.on("data", onData);
	});
}

async function buildSilent(config: Config, target: string): Promise<void> {
	process.stdout.write("  compiling...");
	const start = Date.now();
	try {
		await buildDevTarget(config, target);
		const elapsed = ((Date.now() - start) / 1000).toFixed(2);
		process.stdout.write(`\r  compiled in ${elapsed}s    \n`);
	} catch (e) {
		process.stdout.write("\r  failed           \n");
		log.error(`Build failed: ${(e as Error).message}`);
	}
}

const TARGET_DIRS: Record<string, string> = {
	pulsesync: "ps",
	nextmusic: "nm",
};

let _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let _isBuilding = false;

function isChangeRelevant(filename: string | null, target: string): boolean {
	if (!filename) return false;
	const normalised = filename.replace(/\\/g, "/");
	for (const [t, dir] of Object.entries(TARGET_DIRS)) {
		if (t === target) continue;
		if (
			normalised === dir ||
			normalised.startsWith(dir + "/") ||
			normalised.includes("/" + dir + "/")
		)
			return false;
	}
	return true;
}

function scheduleRebuild(
	config: Config,
	target: string,
	filename: string | null,
): void {
	if (!isChangeRelevant(filename, target)) return;
	if (_rebuildTimer) clearTimeout(_rebuildTimer);
	_rebuildTimer = setTimeout(() => {
		if (_isBuilding) return;
		_isBuilding = true;
		void buildSilent(config, target).finally(() => {
			_isBuilding = false;
		});
	}, 150);
}

function watchDir(watchPath: string, config: Config, target: string): void {
	if (!fs.existsSync(watchPath)) return;
	try {
		fs.watch(watchPath, { recursive: true }, (_event, filename) => {
			scheduleRebuild(config, target, filename);
		});
	} catch {
		watchDirFallback(watchPath, config, target);
	}
}

function watchDirFallback(dir: string, config: Config, target: string): void {
	if (!fs.existsSync(dir)) return;
	if (fs.statSync(dir).isDirectory()) {
		fs.watch(dir, (_event, filename) => {
			scheduleRebuild(config, target, filename);
		});
		for (const entry of fs.readdirSync(dir))
			watchDirFallback(path.join(dir, entry), config, target);
	}
}

export async function runDev(cliTarget?: string): Promise<void> {
	let config: Config;
	try {
		config = loadConfig();
	} catch (e) {
		log.error(`Failed to load config: ${(e as Error).message}`);
		process.exit(1);
	}

	const allTargets = config._targets ?? [];
	const devTargets = allTargets.filter((t) => t !== "web");

	if (devTargets.length === 0) {
		log.error(
			'No dev-compatible targets found. Add "nextmusic", "pulsesync", or "bin" to build.targets.',
		);
		process.exit(1);
	}

	let target: string;

	if (cliTarget) {
		const key = cliTarget.toLowerCase();
		if (!devTargets.includes(key)) {
			log.error(
				`Target "${cliTarget}" is not listed in build.targets. Available dev targets: ${devTargets.join(", ")}`,
			);
			process.exit(1);
		}
		target = key;
	} else if (devTargets.length === 1) {
		target = devTargets[0];
	} else {
		target = await prompt("Select build target:", devTargets);
	}

	log.header("nmtools", config._version);
	process.stdout.write(
		`  target  ${displayName(target)}  •  ${config.addonName}\n\n`,
	);

	await buildSilent(config, target);

	const watchPath = config._srcDir;
	if (!fs.existsSync(watchPath)) {
		log.warn(`Source directory not found: ${watchPath}`);
	} else {
		watchDir(watchPath, config, target);
	}

	process.stdin.resume();
	process.on("SIGINT", () => {
		process.stdout.write("\n");
		process.exit(0);
	});
}
