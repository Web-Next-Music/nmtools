import { cac } from "cac";
import { loadConfig } from "./config.js";
import { buildAll, buildPackage } from "./builder.js";
import { runDev } from "./dev.js";
import { init } from "./init.js";
import { runTypes } from "./types-sync.js";
import * as log from "./logger.js";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };
const HELP =
	"nmtools <command>\n\n  init [--force]       Create an addon project\n  build [targets...]   Build nextmusic, web or bin\n  dev [target]         Watch nextmusic or bin\n  types                Sync Next Music typings\n  version              Print version";

export async function run(args: string[]): Promise<void> {
	if (
		args.length === 0 ||
		args[0] === "help" ||
		args[0] === "--help" ||
		args[0] === "-h"
	) {
		console.log(HELP);
		return;
	}

	const command = args[0];
	if (
		!["init", "types", "dev", "build", "version", "ver"].includes(command)
	) {
		log.error(`Unknown command: "${command}"`);
		process.exit(1);
		return;
	}

	const cli = cac("nmtools");

	cli.command("init", "Create an addon project")
		.option("--force", "Overwrite existing files")
		.action((options: { force?: boolean }) => {
			try {
				init(process.cwd(), Boolean(options.force));
			} catch (error) {
				log.error(`Init failed: ${(error as Error).message}`);
				process.exit(1);
			}
		});

	cli.command("types", "Sync Next Music typings").action(() => {
		try {
			runTypes(process.cwd());
		} catch (error) {
			log.error(`Types sync failed: ${(error as Error).message}`);
			process.exit(1);
		}
	});

	cli.command("dev [target]", "Watch nextmusic or bin").action(
		async (target?: string) => {
			await runDev(target).catch((error: Error) => {
				log.error(`Dev failed: ${error.message}`);
				if (process.env.DEBUG) console.error(error.stack);
				process.exit(1);
			});
		},
	);

	cli.command("build [...targets]", "Build nextmusic, web or bin").action(
		async (targets: string[]) => {
			log.header("nmtools", version);
			let config;
			try {
				config = loadConfig();
			} catch (error) {
				log.error(`Failed to load config: ${(error as Error).message}`);
				process.exit(1);
			}

			try {
				if (targets.length === 0) await buildAll(config);
				else
					for (const target of targets)
						await buildPackage(config, target);
			} catch (error) {
				log.error(`Build failed: ${(error as Error).message}`);
				if (process.env.DEBUG) console.error((error as Error).stack);
				process.exit(1);
			}
		},
	);

	cli.command("version", "Print version")
		.alias("ver")
		.action(() => {
			console.log(`nmtools: ${version}`);
		});

	try {
		cli.parse(["node", "nmtools", ...args], { run: false });
		await cli.runMatchedCommand();
	} catch (error) {
		const message = (error as Error).message;
		if (message.startsWith("Unknown command:")) log.error(message);
		else if (args[0] === "init")
			log.error("Init failed: Usage: nmtools init [--force]");
		else log.error(message);
		process.exit(1);
	}
}
