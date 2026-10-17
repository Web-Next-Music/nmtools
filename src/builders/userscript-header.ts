import type { Config, TMUserScript } from "../types.js";

const STANDARD_USERSCRIPT_FIELDS = [
	"icon",
	"name",
	"namespace",
	"version",
	"description",
	"author",
	"match",
	"grant",
] as const;

const INTERNAL_USERSCRIPT_FIELDS = new Set(["artifactName"]);

type DirectiveValue = string | string[] | boolean | undefined;

function formatDirective(key: string, value: string): string {
	const spaces = Math.max(1, 14 - key.length);
	return `// @${key}${" ".repeat(spaces)}${value}`;
}

function addDirective(
	lines: string[],
	key: string,
	value: DirectiveValue,
): void {
	if (value === undefined) {
		return;
	}
	if (typeof value === "boolean") {
		if (value) {
			lines.push(`// @${key}`);
		}
		return;
	}
	const values = Array.isArray(value) ? value : [value];
	for (const directiveValue of values) {
		if (directiveValue !== "") {
			lines.push(formatDirective(key, directiveValue));
		}
	}
}

function resolveStandardFields(
	config: Config,
	userscript: TMUserScript,
): Record<(typeof STANDARD_USERSCRIPT_FIELDS)[number], DirectiveValue> {
	const authorValue = userscript.author ?? config.author ?? "";
	const author = Array.isArray(authorValue)
		? authorValue.join(", ")
		: authorValue;

	return {
		icon: userscript.icon ?? config.web?.icon ?? "",
		name: userscript.name ?? config.addonName ?? "Addon",
		namespace: userscript.namespace ?? "nmtools",
		version: userscript.version ?? config.version ?? "1.0.0",
		description: userscript.description ?? config.description ?? "",
		author,
		match: userscript.match ?? "https://music.yandex.ru/*",
		grant: userscript.grant ?? "none",
	};
}

export function buildUserscriptHeader(config: Config): string {
	const userscript: TMUserScript = config.web?.userscript ?? {};
	const standardFields = resolveStandardFields(config, userscript);
	const lines: string[] = ["// ==UserScript=="];

	for (const field of STANDARD_USERSCRIPT_FIELDS) {
		addDirective(lines, field, standardFields[field]);
	}

	const handledFields = new Set<string>([
		...STANDARD_USERSCRIPT_FIELDS,
		...INTERNAL_USERSCRIPT_FIELDS,
	]);
	for (const [key, value] of Object.entries(userscript)) {
		if (!handledFields.has(key)) {
			addDirective(lines, key, value);
		}
	}

	lines.push("// ==/UserScript==", "");
	return lines.join("\n");
}
