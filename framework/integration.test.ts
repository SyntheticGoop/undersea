import { describe, expect, it } from "vitest";
import { Endpoint } from "./Endpoint";
import { Initiate } from "./Initiate";
import type { Socket } from "../lib/Socket";
import { CircularBuffer } from "../lib/CircularBuffer";
import { VirtualSocket } from "../clients/VirtualSocket";
import type { Codec } from "./Codec";
import type { Service } from "./Service";
import { Task } from "../lib/Task";

function createSocketPair(): [Socket, Socket] {
	const a = new VirtualSocket({ in: 100, out: 100 });
	const b = new VirtualSocket({ in: 100, out: 100 });

	a.outBuffer.connectPush(b.bufferIn.bind(b));
	b.outBuffer.connectPush(a.bufferIn.bind(a));
	return [a, b];
}

const codec: Codec = {
	encode: (data) => new TextEncoder().encode(JSON.stringify(data)),
	decode: (data) => JSON.parse(new TextDecoder().decode(data)),
};

describe("Initiate-Endpoint", async () => {
	const key = 0xdead;
	const [endpointSocket, initiateSocket] = createSocketPair();
	function endpointSocketListeners() {
		// @ts-ignore
		return endpointSocket.inBufferShared.size;
	}

	function initiateSocketListeners() {
		// @ts-ignore
		return initiateSocket.inBufferShared.size;
	}

	const endpoint = new Endpoint({
		config: {
			ackDeadline: 10,
			clientSilentDeadline: 100,
		},
		codec,
		key,
		createService() {
			const buffer = new CircularBuffer<string | null>(10);

			const service: Service<string, string> = {
				async internal() {
					return buffer.take();
				},
				external(data) {
					return buffer.push(`awesome ${data}`);
				},
				validate() {
					return true;
				},
				loadInternal(payload) {
					return buffer.push(payload);
				},
				takeExternal() {
					// We shouldn't need to pull after the connection is closed.
					return buffer.take().then((data) => data ?? "");
				},
			};

			return service;
		},
	});
	const initiate = new Initiate({
		config: {
			ackDeadline: 10,
			serverSilentDeadline: 100,
		},
		codec,
		key,
		createService() {
			const send = new CircularBuffer<string | null>(10);
			const recv = new CircularBuffer<string>(10);

			const service: Service<string, string> = {
				async internal() {
					return send.take();
				},
				external(data: string) {
					return recv.push(data);
				},
				validate() {
					return true;
				},
				loadInternal(payload) {
					return send.push(payload);
				},
				takeExternal() {
					return recv.take();
				},
			};

			return {
				...service,
				recv,
				send,
			};
		},
	});

	const _server = endpoint.start(async () => {
		return {
			app: null,
			connection: null,
			socket: endpointSocket.multiplex(),
		};
	});
	async function clientAction() {
		return {
			app: null,
			connection: null,
			socket: initiateSocket.multiplex(),
		};
	}
	it("has initial multiplexed connections", () => {
		// Endpoint uses 1 for main socket and 2 for open listener.
		expect(endpointSocketListeners()).toBe(3);

		// Initiate uses 1 for main socket.
		expect(initiateSocketListeners()).toBe(1);
	});

	it("opens a connection between initiator and endpoint", async () => {
		expect(endpointSocketListeners()).toBe(3);
		const client = await initiate.start(new Task(), clientAction);

		client.loadInternal("dog");
		client.loadInternal("cat");
		client.loadInternal("fey");

		expect(client.takeExternal()).resolves.toBe("awesome dog");
		expect(client.takeExternal()).resolves.toBe("awesome cat");
		expect(client.takeExternal()).resolves.toBe("awesome fey");

		client.loadInternal(null);
		await new Promise((ok) => setTimeout(ok, 1));

		// All connections should be closed.
		expect(endpointSocketListeners()).toBe(3);
		expect(initiateSocketListeners()).toBe(1);
	});

	it("opens a second connection between initiator and endpoint", async () => {
		const client = await initiate.start(new Task(), clientAction);
		client.send.push("mom");
		client.send.push("dad");
		client.send.push("kid");

		expect(client.recv.take()).resolves.toBe("awesome mom");
		expect(client.recv.take()).resolves.toBe("awesome dad");
		expect(client.recv.take()).resolves.toBe("awesome kid");

		client.loadInternal(null);
		await new Promise((ok) => setTimeout(ok, 1));

		// All connections should be closed.
		expect(endpointSocketListeners()).toBe(3);
		expect(initiateSocketListeners()).toBe(1);
	});

	it("correctly multiplexes connections", async () => {
		const client1 = await initiate.start(new Task(), clientAction);
		// Because we're testing this in a single thread,
		// we must yield to the event loop to allow the
		// server to properly buffer the connection.
		await new Promise((ok) => setTimeout(ok, 1));
		const client2 = await initiate.start(new Task(), clientAction);
		const recv2 = client2.recv.take();
		const recv1 = client1.recv.take();
		client1.send.push("cos");
		client2.send.push("sin");
		expect(recv1).resolves.toBe("awesome cos");
		expect(recv2).resolves.toBe("awesome sin");
		client1.send.push("tan");
		client2.send.push("sig");
		expect(client1.recv.take()).resolves.toBe("awesome tan");
		expect(client2.recv.take()).resolves.toBe("awesome sig");

		client1.loadInternal(null);
		client2.loadInternal(null);
		await new Promise((ok) => setTimeout(ok, 1));

		// All connections should be closed.
		expect(endpointSocketListeners()).toBe(3);
		expect(initiateSocketListeners()).toBe(1);
	});
});
