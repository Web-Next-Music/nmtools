import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import type { Replacement } from "./types.js";

export function parseEnvFile(content: string): Record<string, string> {
	return dotenv.parse(content);
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
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		const templateReplacement = resolveEnvReferences(
			`\${process.env.${key}}`,
			resolvedEnv,
		);
		replacements.push({
			from: `\${process.env.${key}}`,
			to: templateReplacement,
		});

		replacements.push({
			from: `process.env.${key}`,
			to: JSON.stringify(value),
		});
	}

	return replacements;
}
