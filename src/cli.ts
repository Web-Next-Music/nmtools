import { loadConfig } from "./config.js";
import { buildAll, buildPackage } from "./builder.js";
import { runDev } from "./dev.js";
import { init } from "./init.js";
import { runTypes } from "./types-sync.js";
import * as log from "./logger.js";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

export async function run(args: string[]): Promise<void> {
	const [command, ...rest] = args;

	if (
		!command ||
		command === "help" ||
		command === "--help" ||
		command === "-h"
	) {
		console.log(
			"nmtools <command>\n\n  init [--force]       Create an addon project\n  build [targets...]   Build nextmusic, web or bin\n  dev [target]         Watch nextmusic or bin\n  types                Sync Next Music typings\n  version              Print version",
		);
		return;
	}

	if (command === "init") {
		try {
			if (rest.some((arg) => arg !== "--force"))
				throw new Error("Usage: nmtools init [--force]");
			init(process.cwd(), rest.includes("--force"));
		} catch (e) {
			log.error(`Init failed: ${(e as Error).message}`);
			process.exit(1);
		}
		return;
	}

	if (command === "types") {
		try {
			runTypes(process.cwd());
		} catch (e) {
			log.error(`Types sync failed: ${(e as Error).message}`);
			process.exit(1);
		}
		return;
	}

	if (command === "dev") {
		await runDev(rest[0]).catch((e: Error) => {
			log.error(`Dev failed: ${e.message}`);
			if (process.env.DEBUG) console.error(e.stack);
			process.exit(1);
		});
		return;
	}

	if (command === "build") {
		log.header("nmtools", version);

		let config;
		try {
			config = loadConfig();
		} catch (e) {
			log.error(`Failed to load config: ${(e as Error).message}`);
			process.exit(1);
		}

		try {
			if (rest.length === 0) {
				await buildAll(config);
			} else {
				for (const pkg of rest) await buildPackage(config, pkg);
			}
		} catch (e) {
			log.error(`Build failed: ${(e as Error).message}`);
			if (process.env.DEBUG) console.error((e as Error).stack);
			process.exit(1);
		}
		return;
	}

	if (command === "version" || command === "ver") {
		console.log(`nmtools: ${version}`);
		return;
	}

	log.error(`Unknown command: "${command}"`);
	process.exit(1);
}
