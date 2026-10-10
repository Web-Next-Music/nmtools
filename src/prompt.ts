const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const CLEAR_LINE = "\x1b[2K\x1b[1G";

export function prompt<T extends string>(
	question: string,
	choices: readonly T[],
	displayName: (choice: T) => string = (choice) => choice,
): Promise<T> {
	if (!process.stdin.isTTY)
		return Promise.reject(
			new Error(
				"Specify a dev target when stdin is not a terminal: nmtools dev nextmusic",
			),
		);
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
