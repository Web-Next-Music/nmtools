import { isCancel, select } from "@clack/prompts";

export async function prompt<T extends string>(
	question: string,
	choices: readonly T[],
	displayName: (choice: T) => string = (choice) => choice,
): Promise<T> {
	if (!process.stdin.isTTY)
		throw new Error(
			"Specify a dev target when stdin is not a terminal: nmtools dev nextmusic",
		);

	const selected = await select({
		message: question,
		options: choices.map((choice, index) => ({
			value: index,
			label: displayName(choice),
		})),
	});
	if (isCancel(selected)) throw new Error("Selection cancelled");
	return choices[selected];
}
