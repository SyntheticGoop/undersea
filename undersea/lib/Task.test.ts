import { describe, expect, it } from "vitest";
import { Task } from "./Task";

describe.only(Task, () => {
	it("Cannot cancel if already cleaned up", () => {
		const task = new Task();
		task.cleanup("test");
		task.cancel("test");
		expect(task.isCancelled).resolves.toMatchObject({
			reason: "cleanup: test",
		});
	});
});
