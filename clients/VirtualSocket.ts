import { Socket } from "../lib/Socket";
import { CircularBuffer } from "../lib/CircularBuffer";
import { ConnectableCircularBuffer } from "../lib/ConnectableCircularBuffer";

export class VirtualSocket implements Socket {
	public readonly outBuffer: ConnectableCircularBuffer<ArrayBuffer>;
	private inBufferShared: Set<CircularBuffer<ArrayBuffer>>;
	private readonly thisInBuffer: CircularBuffer<ArrayBuffer>;

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
	): Promise<ArrayBuffer> {
		while (true) {
			const value = await this.thisInBuffer.take();

			if (filter(value)) return value;
		}
	}

	multiplex(): Socket {
		const context = {
			thisInBuffer: new CircularBuffer<ArrayBuffer>(this.bufferSize.in),
		};

		this.inBufferShared.add(context.thisInBuffer);

		return {
			send: this.send.bind(this),
			recv: this.recv.bind(context),
			multiplex: this.multiplex.bind(this),
			drop: () => {
				context.thisInBuffer.drop();
				this.inBufferShared.delete(context.thisInBuffer);

				if (this.inBufferShared.size === 0) this.outBuffer.drop();
			},
		};
	}

	drop() {
		this.thisInBuffer.drop();
		this.inBufferShared.delete(this.thisInBuffer);

		if (this.inBufferShared.size === 0) this.outBuffer.drop();
	}
}