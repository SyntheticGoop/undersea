import { describe, expect, it } from "vitest";
import { channel } from "./channel";
import type { Socket } from "../lib/Socket";
import { type CancellableResult, Task } from "../lib/Task";

function wait(ms: number) {
	if (ms === 0) return Promise.resolve();
	return new Promise((res) => setTimeout(res, ms));
}

class MockSocket implements Socket {
	constructor(public delays: number[]) {
		this.broadcast.add(this);
	}

	private readonly buffer: ArrayBuffer[] = [];

	public async recv(filter: (data: ArrayBuffer) => boolean) {
		while (true) {
			const buffer = this.buffer.shift();
			if (buffer && filter(buffer)) {
				return Promise.resolve(buffer);
			}

			await wait(1);
		}
	}

	private broadcast = new Set<MockSocket>();

	public async send(data: ArrayBuffer) {
		await wait(this.delays.shift() ?? 0);

		for (const channel of this.broadcast) {
			channel.buffer.push(data);
		}
	}

	public multiplex(): MockSocket {
		const socket = new MockSocket([]);

		this.broadcast.add(socket);
		socket.broadcast = this.broadcast;

		return socket;
	}
	public drop() {}

	public closed: Promise<void> = Promise.resolve();
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function serializeResult(state: any) {
	if (
		typeof state.reason !== "undefined" ||
		!(state.value instanceof ArrayBuffer)
	)
		return state;

	return {
		value: [...new Uint8Array(state.value)],
	};
}

describe(channel, () => {
	it("opens when sig init is received", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const sent: number[][] = [];
		socket.recv((data) => {
			sent.push([...new Uint8Array(data)]);

			return false;
		});

		const taskResults: Task[] = [];

		const connection = channel(socket, { key: 1 }, task, 10, 10, (task) => {
			taskResults.push(task);
			return {
				pull: () => null,
				push: () => {},
			};
		});

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(5);
		expect(sent).toMatchInlineSnapshot([
			[1, 0, 1, 0, 4, 0, 0, 0, 0, 0],
			[3, 0, 1, 0, 4, 0, 0, 0, 0],
		]);

		expect(
			await Promise.all(taskResults.map((task) => task.isCancelled)),
		).toMatchInlineSnapshot([
			{
				reason: "cleanup: channel stream finished",
			},
			{
				reason: "timeout: sig init",
			},
		]);
	});

	it("closes on recv deadline", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const recv: CancellableResult<ArrayBuffer>[] = [];

		const taskResults: Task[] = [];
		const connection = channel(
			socket.multiplex(),
			{ key: 1 },
			task,
			10,
			40,
			(task) => {
				taskResults.push(task);
				return {
					pull: () => wait(30).then(() => null),
					push: (data) => recv.push(data),
				};
			},
		);

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(5);

		socket.send(
			new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 5, 4, 3])
				.buffer,
		);
		await wait(20);

		expect(await taskResults[0].isCancelled).toMatchInlineSnapshot(`
			{
			  "reason": "cleanup: channel stream finished",
			}
		`);
		await wait(5);
		expect(recv.map(serializeResult)).toMatchInlineSnapshot([
			{
				value: [5, 4, 3],
			},
			{
				reason: "parent cancelled: finished",
			},
		]);
	});

	it("closes on sig term", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const taskResults: Task[] = [];
		const connection = channel(
			socket.multiplex(),
			{ key: 1 },
			task,
			10,
			10,
			(task) => {
				taskResults.push(task);
				return {
					pull: () => wait(30).then(() => null),
					push: () => {},
				};
			},
		);

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(5);

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 0b1]).buffer,
		);
		await wait(20);

		expect(await taskResults[0].isCancelled).toMatchObject({
			reason: "cleanup: race: finished",
		});
	});

	it("sends data", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const recv: CancellableResult<ArrayBuffer>[] = [];
		const sent: number[][] = [];
		const taskResults: Task[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b10) {
				sent.push([...new Uint8Array(data)]);
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}

			return false;
		});
		const connection = channel(
			socket.multiplex(),
			{ key: 1 },
			task,
			20,
			1000,
			(task) => {
				taskResults.push(task);
				return {
					pull: ((): (() => Promise<ArrayBuffer> | null) => {
						const data = [
							new Uint8Array([2]).buffer,
							new Uint8Array([1]).buffer,
							new Uint8Array([0]).buffer,
						];
						return () => {
							const next = data.pop();
							return next ? Promise.resolve(next) : null;
						};
					})(),
					push: (data) => recv.push(data),
				};
			},
		);

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(30);

		expect(await taskResults[0].isCancelled).toMatchObject({
			reason: "cleanup: channel stream finished",
		});

		expect(sent).toMatchInlineSnapshot([
			[2, 0, 1, 0, 4, 1, 0, 0, 0, 0],
			[2, 0, 1, 0, 4, 2, 0, 0, 0, 1],
			[2, 0, 1, 0, 4, 3, 0, 0, 0, 2],
		]);
	});

	it("handles multiple streams", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const recv: CancellableResult<ArrayBuffer>[] = [];
		const sent: number[][] = [];
		const taskResults: Task[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b10) {
				sent.push([...new Uint8Array(data)]);
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}

			return false;
		});

		const connection = channel(
			socket.multiplex(),
			{ key: 1 },
			task,
			50,
			1000,
			(task) => {
				taskResults.push(task);
				return {
					pull: ((): (() => Promise<ArrayBuffer> | null) => {
						const data = [
							new Uint8Array([2]).buffer,
							new Uint8Array([1]).buffer,
							new Uint8Array([0]).buffer,
						];
						return () => {
							const next = data.pop();
							return next ? Promise.resolve(next) : null;
						};
					})(),
					push: (data) => recv.push(data),
				};
			},
		);

		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(1);
		socket.send(
			new Uint8Array([0b01, 0x00, 0x01, 0x00, 0x05, 0, 0, 0, 0, 0b0]).buffer,
		);

		await wait(20);

		expect(await taskResults[0].isCancelled).toMatchObject({
			reason: "cleanup: channel stream finished",
		});
		expect(await taskResults[1].isCancelled).toMatchObject({
			reason: "cleanup: channel stream finished",
		});

		await wait(10);
		expect(sent).toMatchInlineSnapshot([
			[2, 0, 1, 0, 4, 1, 0, 0, 0, 0],
			[2, 0, 1, 0, 5, 1, 0, 0, 0, 0],
			[2, 0, 1, 0, 4, 2, 0, 0, 0, 1],
			[2, 0, 1, 0, 5, 2, 0, 0, 0, 1],
			[2, 0, 1, 0, 5, 3, 0, 0, 0, 2],
			[2, 0, 1, 0, 4, 3, 0, 0, 0, 2],
		]);
	});
});
