import { describe, expect, it } from "vitest";
import { ConnectableCircularBuffer } from "./ConnectableCircularBuffer";

describe(ConnectableCircularBuffer, () => {
	it("should not allow take if connected", async () => {
		const buffer = new ConnectableCircularBuffer<number>(10);

		buffer.connectPush(() => {});

		expect(() => buffer.take()).toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take if connected]",
		);
	});

	it("should flush circularly when connected", async () => {
		const buffer = new ConnectableCircularBuffer<number>(4);
		buffer.push(1);
		buffer.push(2);
		buffer.take();
		buffer.take();

		buffer.push(3);
		buffer.push(4);
		buffer.push(5);
		buffer.push(6);

		const flushed: number[] = [];
		buffer.connectPush((number) => flushed.push(number));
		buffer.push(7);
		expect(flushed).toEqual([3, 4, 5, 6, 7]);
	});
});
