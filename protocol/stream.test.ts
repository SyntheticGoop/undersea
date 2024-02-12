import { describe, expect, it } from "vitest";
import { stream } from "./stream";
import { Socket } from "../lib/Socket";
import { Task } from "../lib/Task";
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

describe(stream, () => {
	it("streams data on the socket to end", async () => {
		const socket = new MockSocket([]);
		const task = new Task();
		const atomic = new Atomic(0xffff_ffff);

		const sent: ArrayBuffer[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b10) {
				sent.push(data);
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}
			return false;
		});

		await stream(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			atomic,
			20,
			((): (() => Promise<ArrayBuffer> | null) => {
				const data = [
					new Uint8Array([4]).buffer,
					new Uint8Array([2]).buffer,
					new Uint8Array([1]).buffer,
					new Uint8Array([0]).buffer,
				];
				return () => {
					const next = data.pop();
					return next ? Promise.resolve(next) : null;
				};
			})(),
		);

		expect(sent.map((data) => [...new Uint8Array(data)])).toMatchObject([
			[0b10, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0],
			[0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1],
			[0b10, 0x00, 0x01, 0x00, 0x04, 2, 0, 0, 0, 2],
			[0b10, 0x00, 0x01, 0x00, 0x04, 3, 0, 0, 0, 4],
		]);
	});

	it("streams data on the socket and cancels", async () => {
		const socket = new MockSocket([]);
		const task = new Task();
		const atomic = new Atomic(0xffff_ffff);

		const sent: ArrayBuffer[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b10) {
				sent.push(data);
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}
			return false;
		});

		const streamSocket = socket.multiplex();
		streamSocket.delays = [1, 1, 20];
		const handle = stream(
			streamSocket,
			{ key: 1, nonce: 4 },
			task,
			atomic,
			10,
			((): (() => Promise<ArrayBuffer> | null) => {
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
		);

		await wait(15);
		task.cancel("test");
		expect(handle).resolves.toMatchObject({
			reason: "parent cancelled: test",
		});

		expect(sent.map((data) => [...new Uint8Array(data)])).toMatchObject([
			[0b10, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0],
			[0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1],
		]);
	});

	it("streams async data and cancels on no ack", async () => {
		const socket = new MockSocket([]);
		const task = new Task();
		// task.deadline(10);

		const atomic = new Atomic(0xffff_ffff);

		const sent: ArrayBuffer[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b10) {
				sent.push(data);
				if (view.getUint32(5, true) === 0)
					socket.send(
						new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
					);
			}
			return false;
		});

		const handle = await stream(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			atomic,
			10,
			((): (() => Promise<ArrayBuffer> | null) => {
				const data = [
					new Uint8Array([4]).buffer,
					new Uint8Array([2]).buffer,
					new Uint8Array([1]).buffer,
					new Uint8Array([0]).buffer,
				];
				return () => {
					const next = data.pop();
					return next ? Promise.resolve(next) : null;
				};
			})(),
		);

		expect(handle).toMatchObject({
			reason: "timeout: send ack",
		});

		expect(sent.map((data) => [...new Uint8Array(data)])).toMatchObject([
			[0b10, 0x00, 0x01, 0x00, 0x04, 0, 0, 0, 0, 0],
			[0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1], // This extra one is sent for which we don't receive an ack, so we cancel after it.
		]);
	});
});
