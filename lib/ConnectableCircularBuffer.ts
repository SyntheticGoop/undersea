import { CircularBuffer } from "./CircularBuffer";

export class ConnectableCircularBuffer<T> extends CircularBuffer<T> {
	private connectedPush: ((value: T) => void) | null = null;

	/**
	 * Replaces calls to `push` with calls to `onPush` if the buffer is empty.
	 */
	public connectPush(onPush: (value: T) => void) {
		if (this.onPush.length > 0) {
			throw new Error("Cannot connect push if there are pending pushes");
		}

		if (this.connectedPush !== null) {
			throw new Error("Cannot connect push if already connected");
		}

		this.connectedPush = onPush;

		const values: T[] = [];

		if (this.head > this.tail) {
			for (let i = this.head; i < this.buffer.length; i++) {
				values.push(this.buffer[i]);
				delete this.buffer[i];
			}
			this.head = 0;
		}

		if (this.head < this.tail) {
			for (let i = 0; i < this.tail; i++) {
				values.push(this.buffer[i]);
				delete this.buffer[i];
				this.head = i;
			}
		}

		for (const value of values) {
			this.connectedPush(value);
		}
	}

	public push(value: T): boolean {
		if (this.connectedPush !== null) {
			this.connectedPush(value);
			return true;
		}

		return super.push(value);
	}

	public take(): Promise<T> {
		if (this.connectedPush) {
			throw new Error("Cannot take if connected");
		}

		return super.take();
	}
}
