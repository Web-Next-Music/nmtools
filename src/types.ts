import type { Target } from "./targets.js";
export type { Target } from "./targets.js";


export interface Replacement {
	from: string;
	to?: string;
}

export interface TMUserScript {
	name?: string;
	namespace?: string;
	version?: string;
	description?: string;
	author?: string;
	icon?: string;
	homepage?: string;
	match?: string | string[];
	"exclude-match"?: string | string[];
	include?: string | string[];
	exclude?: string | string[];
	grant?: string | string[];
	connect?: string | string[];
	require?: string | string[];
	resource?: string | string[];
	"run-at"?: string;
	noframes?: boolean;
	sandbox?: string;
	[key: string]: string | string[] | boolean | undefined;
}

export interface ProjectConfig {
	name?: string;
	version?: string;
	addonName?: string;
	description?: string | string[];
	author?: string | string[];
	build: {
		src?: string;
		targets?: string[];
		/** @deprecated Use targets instead. */
		package?: string[];
	};
	nextmusic?: {
		tarGz?: { artifactName: string };
	};
	web?: {
		/** @deprecated Use `userscript` section instead */
		onefile?: { artifactName: string };
		icon?: string;
		replaceLink?: Replacement[];
		userscript?: TMUserScript & { artifactName?: string };
	};
	bin?: {
		artifactName?: string;
	};
}

export interface Config extends ProjectConfig {
	version: string;
	addonName: string;
	// Internal fields added by loadConfig
	_targets: Target[] & {
		includes(searchElement: string, fromIndex?: number): boolean;
	};
	_cwd: string;
	_version: string;
	_srcDir: string;
	_buildIgnore: string;
	_env: Record<string, string>;
}

export interface ArchiveEntry {
	disk: string;
	archive: string;
}

import type { Stats } from "fs";

export interface TarEntry {
	disk: string | null;
	name: string;
	stat: Stats;
	type: "0" | "5";
}
