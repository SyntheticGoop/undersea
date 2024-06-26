import { describe, expect, it, vi } from "vitest";
import { recv } from "./recv";
import { Task } from "../lib/Task";
import type { Socket } from "../lib/Socket";

function wait(ms: number) {
	if (ms === 0) return Promise.resolve();
	return new Promise((res) => setTimeout(res, ms));
}

class MockSocket implements Socket {
	public closed: Promise<void>;
	private close: () => void = () => {};
	constructor(public delays: number[]) {
		this.broadcast.add(this);

		this.closed = new Promise((res) => {
			this.close = res;
		});
	}

	private buffer: ArrayBuffer[] = [];
	recvLocks = 0;

	public async recv(filter: (data: ArrayBuffer) => boolean, task: Task) {
		this.recvLocks += 1;
		try {
			while (true) {
				const buffer = this.buffer.shift();
				if (buffer && filter(buffer)) {
					return Promise.resolve(buffer);
				}

				const ok = await Promise.race([
					wait(1).then(() => true),
					this.closed.then(() => false),
					task.isCancelled.then(() => false),
				]);

				if (!ok) throw new Error("Socket closed");
			}
		} finally {
			this.recvLocks -= 1;
		}
	}

	private broadcast = new Set<MockSocket>();

	public async send(data: ArrayBuffer) {
		await wait(this.delays.shift() ?? 0);

		for (const channel of this.broadcast) {
			channel.buffer.push(data);
		}
	}

	public multiplex(options?: { clone?: boolean }): MockSocket {
		const socket = new MockSocket([]);
		socket.buffer = options?.clone === true ? [...this.buffer] : [];

		this.broadcast.add(socket);
		socket.broadcast = this.broadcast;

		return socket;
	}

	public drop() {
		this.close();
	}
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

describe(recv, () => {
	it("receives data on the socket", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const wait = recv(socket, { key: 1, nonce: 4, type: "MSG" }, task)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.then((data) => [...new Uint8Array((data as any).value.buffer)])
			.then((data) => expect(data).toMatchObject([1, 0, 1]));

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
		await wait;
	});

	it("only calls recv listener once", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const filter = vi.fn((a) => a);

		const wait = recv(socket, { key: 1, nonce: 4, type: "MSG", filter }, task)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.then((data) => [...new Uint8Array((data as any).value.buffer)])
			.then((data) => expect(data).toMatchObject([1, 0, 1]));

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 2]).buffer);

		await wait;
		expect(filter).toHaveBeenCalledTimes(1);
	});

	it("receives filtered data on the socket", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const wait = recv(
			socket,
			{
				key: 1,
				nonce: 4,
				type: "MSG",
				filter(data) {
					if (new DataView(data.buffer).getUint8(0) !== 1) return null;
					return data.buffer.slice(1);
				},
			},
			task,
		)
			.then(serializeResult)
			.then((data) =>
				expect(data).toMatchObject({
					value: [0, 1],
				}),
			);

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 2, 2, 1]).buffer);
		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
		await wait;
	});

	it("times out before receiving data", async () => {
		const socket = new MockSocket([20]);
		const task = new Task();

		const wait = recv(socket, { key: 1, nonce: 4, type: "MSG" }, task)
			.deadline(10, "test")
			.then((data) =>
				expect(data).toMatchObject({
					reason: "timeout: test",
				}),
			);

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
		await wait;
	});

	it("is cancelled before receiving data", async () => {
		const socket = new MockSocket([10]);
		const task = new Task();

		recv(socket, { key: 1, nonce: 4, type: "MSG" }, task).then((data) =>
			expect(data).toMatchObject({
				reason: "test",
			}),
		);

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
		task.cancel("test");
	});

	it("is cancelled before starting to receive data", async () => {
		const socket = new MockSocket([10]);

		const task = new Task();

		task.cancel("test");
		recv(socket, { key: 1, nonce: 4, type: "MSG" }, task).then((data) =>
			expect(data).toMatchObject({
				reason: "test",
			}),
		);

		socket.send(new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1]).buffer);
	});

	it("gracefully handles socket drop", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const wait = recv(socket, { key: 1, nonce: 4, type: "MSG" }, task);

		socket.drop();

		await wait;
		expect(socket.recvLocks).toBe(0);
	});

	it("gracefully handles task end", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const wait = recv(socket, { key: 1, nonce: 4, type: "MSG" }, task);

		task.cleanup("test");
		await wait;
		expect(socket.recvLocks).toBe(0);
	});
});
