export class CircularBuffer<T> {
	protected buffer: T[];
	protected head = 0;
	protected tail = 0;
	private dropped = false;

	constructor(private readonly size: number) {
		this.size += 1;
		this.buffer = new Array(size);
	}

	protected onPush: Array<
		| { push(value: T): void; drop(): void; flush: false }
		| { push(value: T[]): void; drop(): void; flush: true }
	> = [];

	/**
	 * Flush is guaranteed to be immediately resolvable if there
	 * are no pending pushes.
	 */
	public flush(): Promise<T[]> {
		if (this.dropped) throw Error("Cannot flush after drop");

		if (this.head === this.tail && this.onPush.length === 0) {
			return Promise.resolve([]);
		}

		if (this.head === this.tail) {
			return new Promise<T[]>((push, drop) => {
				this.onPush.push({
					push,
					drop,
					flush: true,
				});
			});
		}

		if (this.head < this.tail) {
			const values = this.buffer.slice(this.head, this.tail);
			this.head = 0;
			this.tail = 0;
			return Promise.resolve(values);
		}

		const values = this.buffer
			.slice(this.head)
			.concat(this.buffer.slice(0, this.tail));
		this.head = 0;
		this.tail = 0;
		return Promise.resolve(values);
	}

	/**
	 * Pushes a value into the buffer.
	 *
	 * @param value The value to push into the buffer.
	 * @returns `true` if the value was pushed into the buffer.
	 * @returns `false` if the buffer is full.
	 */
	public push(value: T): boolean {
		if (this.dropped) throw Error("Cannot push after drop");

		const onPush = this.onPush.shift();
		if (onPush) {
			if (this.tail !== this.head) {
				this.onPush.unshift(onPush);
				throw new Error(
					"Invariant violation: Push callbacks cannot be added if the buffer is not empty!",
				);
			}

			if (onPush.flush) {
				onPush.push([value]);
			} else {
				onPush.push(value);
			}
			return true;
		}

		const nextTail = (this.tail + 1) % this.size;

		if (nextTail === this.head) {
			return false;
		}

		this.buffer[this.tail] = value;
		this.tail = nextTail;
		return true;
	}

	/**
	 * Takes a value from the buffer.
	 *
	 * @returns `Promise<T>` The value taken from the buffer.
	 * @returns `undefined` if the buffer is empty.
	 */
	public take(): Promise<T> {
		if (this.dropped) throw Error("Cannot take after drop");

		if (this.head === this.tail) {
			return new Promise((push, drop) => {
				this.onPush.push({
					push,
					drop,
					flush: false,
				});
			});
		}

		const value = this.buffer[this.head];
		delete this.buffer[this.head];

		this.head = (this.head + 1) % this.size;

		return Promise.resolve(value);
	}

	/**
	 * Remove all pending push callbacks.
	 */
	public drop() {
		this.dropped = true;
		for (const push of this.onPush) {
			push.drop();
		}
	}
}
