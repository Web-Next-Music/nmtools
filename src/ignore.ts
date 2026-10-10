import path from "path";

export function parseBuildIgnore(raw = ""): string[] {
	return raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
}

export function shouldIgnore(diskPath: string, rules: string[]): boolean {
	if (!rules || rules.length === 0) return false;

	const normalised = diskPath.replace(/\\/g, "/");
	const basename = path.posix.basename(normalised);

	for (const rule of rules) {
		if (
			rule.startsWith("*.") ||
			(rule.startsWith(".") && !rule.includes("/"))
		) {
			const suffix = rule.startsWith("*.") ? rule.slice(1) : rule;
			if (basename.toLowerCase().endsWith(suffix.toLowerCase()))
				return true;
			continue;
		}

		if (!rule.includes("/") && rule.includes("*")) {
			if (minimatch(basename, rule)) return true;
			continue;
		}

		const ruleClean = rule.replace(/\/$/, "");
		if (!ruleClean.includes("/")) {
			if (basename === ruleClean) return true;
		} else {
			if (
				normalised.endsWith("/" + ruleClean) ||
				normalised.includes("/" + ruleClean + "/")
			)
				return true;
		}
	}
	return false;
}

function minimatch(str: string, pattern: string): boolean {
	const re = new RegExp(
		"^" +
			pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
			"$",
	);
	return re.test(str);
}
