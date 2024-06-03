import { describe, expect, it } from "vitest";
import { listen } from "./listen";
import type { Socket } from "../lib/Socket";
import { type CancellableResult, Task } from "../lib/Task";
import { Atomic } from "../lib/Atomic";

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

describe(listen, () => {
	it("listens to async data on socket until stopped", async () => {
		const socket = new MockSocket([]);
		const task = new Task();
		const atomic = new Atomic(0xffff_ffff);

		const received: CancellableResult<ArrayBuffer>[] = [];
		const sent: ArrayBuffer[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b11) {
				sent.push(data);
			}
			return false;
		});

		listen(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			atomic,
			100,
			(data) => received.push(data),
		);

		wait(10).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0]).buffer,
			),
		);
		wait(20).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1]).buffer,
			),
		);

		await wait(15);
		task.cleanup("test");

		socket.send(
			new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 3, 0, 0, 0, 4]).buffer,
		);

		expect(received.map(serializeResult)).toMatchObject([
			{
				value: [0],
			},
		]);

		await wait(5);
		expect(sent.map((data) => [...new Uint8Array(data)])).toMatchObject([
			[0b11, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0],
		]);
	});

	it("listens to async data on socket until timeout", async () => {
		const socket = new MockSocket([]);
		const task = new Task();
		const atomic = new Atomic(0xffff_ffff);

		const received: CancellableResult<ArrayBuffer>[] = [];
		const sent: ArrayBuffer[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b11) {
				sent.push(data);
			}
			return false;
		});

		listen(socket.multiplex(), { key: 1, nonce: 4 }, task, atomic, 15, (data) =>
			received.push(data),
		);

		wait(10).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0]).buffer,
			),
		);
		wait(30).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1]).buffer,
			),
		);

		await wait(35);
		task.cleanup("test");

		expect(received.map(serializeResult)).toMatchObject([
			{
				value: [0],
			},
			{
				reason: "timeout: listen",
			},
		]);

		expect(sent.map((data) => [...new Uint8Array(data)])).toMatchObject([
			[0b11, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0],
		]);
	});
});
