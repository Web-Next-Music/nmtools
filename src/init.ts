import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { syncTypes } from "./types-sync.js";
import config from "../package.json" with { type: "json" };


const DEFAULT_PKG = {
	name: "my-addon",
	addonName: "My Addon",
	version: "1.0.0",
	description: "Hello, World!",
	author: "developer",
	license: "MIT",
	scripts: {
		dev: "nmtools dev",
		build: "nmtools build",
		"build:nextmusic": "nmtools build nextmusic",
		"build:web": "nmtools build web",
	},
	build: {
		src: "src",
		targets: ["nextmusic", "web"],
	},
	nextmusic: {
		tarGz: { artifactName: "${addon.name}_${addon.version}_nm.tar.gz" },
	},
	web: {
		userscript: {
			artifactName: "${addon.name}_${addon.version}_web.user.js",
		},
	},
	devDependencies: {
		[config.name]: `^${config.version}`,
	},
};

export function init(cwd = process.cwd(), force = false): void {
	const pkgPath = path.join(cwd, "package.json");
	if (fs.existsSync(pkgPath) && !force)
		throw new Error(
			"package.json already exists. Use init --force to replace it explicitly.",
		);
	log.task("init");

	// package.json
	fs.writeFileSync(pkgPath, JSON.stringify(DEFAULT_PKG, null, 2), {
		encoding: "utf8",
		flag: force ? "w" : "wx",
	});
	log.file("write", "package.json");

	function writeIfMissing(name: string, content: string): void {
		const file = path.join(cwd, name);
		if (fs.existsSync(file)) return;
		fs.writeFileSync(file, content, "utf8");
		log.file("write", name);
	}

	for (const dir of [
		"src",
		"src/assets",
		"src/assets/branding",
		"src/nm",
		"src/web",
	]) {
		fs.mkdirSync(path.join(cwd, dir), { recursive: true });
		log.file("write", `${dir}/`);
	}

	writeIfMissing("src/style.css", "/* shared styles */\n");

	// IDE support; builds use Bun.build rather than tsc.
	writeIfMissing(
		"tsconfig.json",
		JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					lib: ["ES2022", "DOM", "DOM.Iterable"],
					module: "ESNext",
					moduleResolution: "bundler",
					jsx: "react",
					jsxFactory: "React.createElement",
					jsxFragmentFactory: "React.Fragment",
					strict: true,
					noEmit: true,
					allowJs: true,
					skipLibCheck: true,
				},
				include: ["src/**/*", "types/**/*"],
			},
			null,
			2,
		),
	);

	if (!fs.existsSync(path.join(cwd, "src/script.js")))
		writeIfMissing("src/script.ts", "// shared script\n");

	writeIfMissing(
		".buildignore",
		"# Files to exclude from builds\n.DS_Store\n*.map\n*.d.ts\n",
	);

	// types/nextmusic.d.ts
	syncTypes(cwd);

	log.done("init");
}
