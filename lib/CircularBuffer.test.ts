import { describe, expect, it } from "vitest";
import { CircularBuffer } from "./CircularBuffer";

describe(CircularBuffer, () => {
	it("should push on to buffer", () => {
		const buffer = new CircularBuffer(1);
		buffer.push(1);
		expect(buffer.take()).resolves.toBe(1);
	});

	it("should push on to buffer FIFO", () => {
		const buffer = new CircularBuffer(2);
		buffer.push(1);
		buffer.push(2);
		expect(buffer.take()).resolves.toBe(1);
		expect(buffer.take()).resolves.toBe(2);
	});

	it("should call back on buffered", () => {
		const buffer = new CircularBuffer(2);
		const next0 = buffer.take();
		const next1 = buffer.take();
		buffer.push(0);
		buffer.push(1);
		expect(next0).resolves.toBe(0);
		expect(next1).resolves.toBe(1);
	});

	it("should flush empty", () => {
		const buffer = new CircularBuffer(2);
		expect(buffer.flush()).resolves.toEqual([]);
	});

	it("should flush all values", () => {
		const buffer = new CircularBuffer(2);
		buffer.push(0);
		buffer.push(1);
		expect(buffer.flush()).resolves.toEqual([0, 1]);
	});

	it("should buffer flush among other takes", () => {
		const buffer = new CircularBuffer(3);
		const next0 = buffer.take();
		const next1 = buffer.flush();
		const next2 = buffer.take();
		buffer.push(0);
		buffer.push(1);
		buffer.push(2);
		expect(next0).resolves.toBe(0);
		expect(next1).resolves.toEqual([1]);
		expect(next2).resolves.toBe(2);
	});

	it("is an error to interact after drop", () => {
		const buffer = new CircularBuffer(1);
		buffer.drop();
		expect(() => buffer.push(0)).toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot push after drop]",
		);

		expect(() => buffer.take()).toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);

		expect(() => buffer.flush()).toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot flush after drop]",
		);
	});
});
