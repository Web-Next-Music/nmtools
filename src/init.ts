import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { syncTypes } from "./types-sync.js";
import config from "../package.json" with { type: "json" };

const DEFAULT_METADATA = {
	name: "addon",
	author: ["developer"],
	description: "Hello, World!",
	type: "theme",
	version: "1.0.0",
	css: "style.css",
	script: "script.js",
};

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

	// src/
	const srcDir = path.join(cwd, "src");

	fs.mkdirSync(srcDir, { recursive: true });
	log.file("write", "src/");

	// src/metadata.json
	const metaPath = path.join(srcDir, "metadata.json");

	if (!fs.existsSync(metaPath)) {
		fs.writeFileSync(
			metaPath,
			JSON.stringify(DEFAULT_METADATA, null, 2),
			"utf8",
		);
		log.file("write", "src/metadata.json");
	}

	// src/style.css
	const cssPath = path.join(srcDir, "style.css");

	if (!fs.existsSync(cssPath)) {
		fs.writeFileSync(cssPath, "/* shared styles */\n", "utf8");
		log.file("write", "src/style.css");
	}

	// tsconfig.json - для IDE-поддержки (сборка идёт через Bun.build, не tsc)
	const tsconfigPath = path.join(cwd, "tsconfig.json");

	if (!fs.existsSync(tsconfigPath)) {
		const tsconfig = {
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
		};

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(tsconfig, null, 2),
			"utf8",
		);
		log.file("write", "tsconfig.json");
	}

	// src/script.ts - TypeScript entry point
	const tsPath = path.join(srcDir, "script.ts");
	const jsPath = path.join(srcDir, "script.js");

	if (!fs.existsSync(tsPath) && !fs.existsSync(jsPath)) {
		fs.writeFileSync(tsPath, "// shared script\n", "utf8");
		log.file("write", "src/script.ts");
	}

	// src/assets/
	const assetsDir = path.join(srcDir, "assets");

	fs.mkdirSync(assetsDir, { recursive: true });
	log.file("write", "src/assets/");

	// src/assets/branding/
	const brandingDir = path.join(assetsDir, "branding");

	fs.mkdirSync(brandingDir, { recursive: true });
	log.file("write", "src/assets/branding/");

	// src/nm/
	const nmDir = path.join(srcDir, "nm");

	fs.mkdirSync(nmDir, { recursive: true });
	log.file("write", "src/nm/");

	// src/web/
	const webDir = path.join(srcDir, "web");

	fs.mkdirSync(webDir, { recursive: true });
	log.file("write", "src/web/");

	// .buildignore
	const ignorePath = path.join(cwd, ".buildignore");

	if (!fs.existsSync(ignorePath)) {
		fs.writeFileSync(
			ignorePath,
			"# Files to exclude from builds\n.DS_Store\n*.map\n*.d.ts\n",
			"utf8",
		);
		log.file("write", ".buildignore");
	}

	// types/nextmusic.d.ts
	syncTypes(cwd);

	log.done("init");
}
