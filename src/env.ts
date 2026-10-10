import fs from "fs";
import path from "path";
import type { Replacement } from "./types.js";

export function parseEnvFile(content: string): Record<string, string> {
	const env: Record<string, string> = {};

	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;

		const key = trimmed.substring(0, eqIndex).trim();
		let value = trimmed.substring(eqIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		env[key] = value;
	}

	return env;
}

export function loadEnvFile(cwd: string): Record<string, string> {
	const envPath = path.join(cwd, ".env");

	if (!fs.existsSync(envPath)) {
		return {};
	}

	try {
		const content = fs.readFileSync(envPath, "utf8");
		return parseEnvFile(content);
	} catch {
		return {};
	}
}

export function filterEnvByPrefix(
	env: Record<string, string>,
	prefix: string,
): Record<string, string> {
	const filtered: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.startsWith(prefix)) {
			filtered[key] = value;
		}
	}

	return filtered;
}

export function resolveEnvReferences(
	text: string,
	env: Record<string, string>,
): string {
	return text.replace(
		/\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}/g,
		(match, varName) => {
			return env[varName] ?? match;
		},
	);
}

export function generateEnvReplacements(
	envFileContent: Record<string, string>,
	isDev: boolean,
): Replacement[] {
	const filteredEnv = isDev
		? envFileContent
		: filterEnvByPrefix(envFileContent, "NMTOOLS_PUBLIC_");

	const resolvedEnv = {
		...process.env,
		...filteredEnv,
	} as Record<string, string>;

	const replacements: Replacement[] = [];

	for (const [key, value] of Object.entries(filteredEnv)) {
		const templateReplacement = resolveEnvReferences(
			`$\{process\.env\.${key}\}`,
			resolvedEnv,
		);
		replacements.push({
			from: `$\{process\.env\.${key}\}`,
			to: templateReplacement,
		});

		replacements.push({
			from: `process\.env\.${key}`,
			to: JSON.stringify(value),
		});
	}

	return replacements;
}
