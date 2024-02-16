export function wait(
	ms: number,
	abort: { timeout?: ReturnType<typeof setTimeout> } = {},
): Promise<void> {
	return new Promise((resolve) => {
		abort.timeout = setTimeout(resolve, ms);
	});
}
