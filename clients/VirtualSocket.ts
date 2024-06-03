import type { Socket } from "../lib/Socket";
import { CircularBuffer } from "../lib/CircularBuffer";
import { ConnectableCircularBuffer } from "../lib/ConnectableCircularBuffer";
import type { Task } from "../lib/Task";

/**
 * A virtual socket that can be used for testing or to derive other sockets for.
 *
 * The virtual socket maintains a buffer for incoming and outgoing data and
 * can share that incoming buffer across multiplexed connections.
 */
export class VirtualSocket implements Socket {
	public readonly outBuffer: ConnectableCircularBuffer<ArrayBuffer>;
	private inBufferShared: Set<CircularBuffer<ArrayBuffer>>;
	private readonly thisInBuffer: CircularBuffer<ArrayBuffer>;
	private killed = new CircularBuffer<void>(1);
	public closed: Promise<void> = this.killed.take();

	constructor(
		private readonly bufferSize: {
			in: number;
			out: number;
		},
	) {
		this.outBuffer = new ConnectableCircularBuffer<ArrayBuffer>(bufferSize.out);
		this.thisInBuffer = new CircularBuffer<ArrayBuffer>(bufferSize.in);
		this.inBufferShared = new Set([this.thisInBuffer]);
	}

	public bufferIn(bytes: ArrayBuffer) {
		for (const buffer of this.inBufferShared) {
			buffer.push(bytes);
		}
	}

	public send(bytes: ArrayBuffer) {
		this.outBuffer.push(bytes);
	}

	public async recv(
		filter: (data: ArrayBuffer) => boolean,
		task: Task,
	): Promise<ArrayBuffer> {
		while (typeof task.isCancelled() !== "string") {
			const value = await Promise.race([
				this.thisInBuffer.take(),
				task.isCancelled.then(() => null),
			]);

			if (value === null) throw new Error("Task cancelled");
			if (filter(value)) return value;
		}

		throw new Error("Task cancelled");
	}

	multiplex(): Socket {
		const context = {
			thisInBuffer: new CircularBuffer<ArrayBuffer>(this.bufferSize.in),
		};

		this.inBufferShared.add(context.thisInBuffer);
		const killed = new CircularBuffer<void>(1);
		const closed: Promise<void> = killed.take();

		return {
			send: this.send.bind(this),
			recv: this.recv.bind(context),
			multiplex: this.multiplex.bind(this),
			drop: () => {
				killed.push();
				context.thisInBuffer.drop();
				this.inBufferShared.delete(context.thisInBuffer);

				if (this.inBufferShared.size === 0) this.outBuffer.drop();
			},
			closed: Promise.race([closed, this.closed]),
		};
	}

	drop() {
		this.killed.push();
		this.thisInBuffer.drop();
		this.inBufferShared.delete(this.thisInBuffer);

		if (this.inBufferShared.size === 0) this.outBuffer.drop();
	}

	/**
	 * Drops all shared sockets.
	 *
	 * Use this to clean up a connection when it is no longer needed.
	 */
	dropAll() {
		for (const buffer of this.inBufferShared) {
			buffer.drop();
		}

		this.inBufferShared.clear();
		this.outBuffer.drop();
		this.killed.push();
	}
}
