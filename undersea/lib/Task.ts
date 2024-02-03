type Reason = { reason: string };
export type CancellableResult<T> =
	| {
			reason?: undefined;
			value: T;
	  }
	| Reason;

type CancelHandle<T> = {
	/**
	 * Cancels the task with a reason.
	 */
	cancel: (reason: string) => void;
} & T;

type TimeoutHandle<T> = {
	/**
	 * Sets a deadline for the task.
	 *
	 * @param ms Duration before timing out.
	 * @param reason Reason for timing out.
	 */
	deadline: (ms: number, reason: string) => TimeoutHandle<T>;
} & T;

type IsCancelled = (() => string | undefined) & PromiseLike<Reason>;

export type TaskHandle<T> = TimeoutHandle<
	CancelHandle<Promise<CancellableResult<T>>>
>;

/**
 * A cancellable promise that can be resolved or rejected externally at any time.
 *
 * This is useful for creating a promise that can be cancelled externally.
 *
 * Note that you must always call `cleanup` when you are done with the promise,
 * otherwise it will leak memory.
 */
export class Task implements TimeoutHandle<CancelHandle<PromiseLike<string>>> {
	private readonly handles = {
		resolve: null as ((value: string) => void) | null,
		timeout: null as ReturnType<typeof setTimeout> | null,
	};

	private readonly promise: Promise<string>;

	private cancelled: string | undefined = undefined;

	/**
	 * Creates a cancellable promise.
	 */
	constructor() {
		const promise = new Promise<string>((resolve) => {
			this.handles.resolve = resolve;
		});

		this.promise = promise;

		this.isCancelled = Object.assign(() => this.cancelled, {
			then<TResult1 = void, TResult2 = never>(
				onfulfilled?:
					| ((state: { reason: string }) => TResult1 | PromiseLike<TResult1>)
					| null
					| undefined,
				onrejected?:
					| ((error: unknown) => TResult2 | PromiseLike<TResult2>)
					| null
					| undefined,
			): PromiseLike<TResult1 | TResult2> {
				return promise
					.then((reason) => ({ reason }))
					.then(onfulfilled, onrejected);
			},
		});
	}

	public readonly isCancelled: IsCancelled;

	/**
	 * Resolves the promise with a reason.
	 */
	public cancel(reason: string) {
		this.cancelled = reason;
		this.handles.resolve?.(reason);
		this.handles.resolve = null;
	}

	/**
	 * Cleans up the promise.
	 *
	 * Not calling this after you're done with the promise will leak memory.
	 */
	public cleanup(reason: string) {
		this.handles.resolve?.(`cleanup: ${reason}`);
		this.handles.resolve = null;
		if (this.handles.timeout !== null) clearTimeout(this.handles.timeout);
		this.handles.timeout = null;
	}

	/**
	 * Chains a callback to the promise.
	 */
	public then<TResult1 = void, TResult2 = never>(
		onfulfilled?:
			| ((value: string) => TResult1 | PromiseLike<TResult1>)
			| null
			| undefined,
		onrejected?:
			| ((error: unknown) => TResult2 | PromiseLike<TResult2>)
			| null
			| undefined,
	): PromiseLike<TResult1 | TResult2> {
		return this.promise.then(onfulfilled, onrejected);
	}

	/**
	 * Polls a stream while the task is not cancelled.
	 *
	 * The polling function should return `null` when the stream is done.
	 *
	 * @param pull The polling function to call.
	 */
	public async poll(
		/**
		 * The polling function to call.
		 *
		 * @param next The next task to poll.
		 * @returns A cancellable result if the task is running.
		 * @returns `null` if the task is done.
		 */
		pull: (next: this) => Promise<CancellableResult<unknown> | null>,
	): Promise<CancellableResult<void>> {
		while (true) {
			if (typeof this.cancelled === "string") return { reason: this.cancelled };

			const next = await pull(this);

			if (next === null) return { value: undefined };

			if (typeof next.reason === "string") this.cancel(next.reason);
		}
	}

	/**
	 * Races another promise to completion.
	 *
	 * This will always clean up the task.
	 *
	 * @param promise Promise to race against.
	 */
	public async race<T>(promise: Promise<T>): Promise<CancellableResult<T>> {
		return Promise.race([
			this.promise.then((reason) => ({ reason })),
			promise.then((value) => ({ value })),
		]).finally(() => {
			this.cleanup(
				`race: ${this.handles.resolve === null ? "cancelled" : "finished"}`,
			);
		});
	}

	/**
	 * Wraps a callback in a cancellable promise.
	 *
	 * The callback will be passed a function that polls the cancellation state.
	 * The callback may return a cleanup function that will be called when the
	 * task ends. This function should not throw.
	 *
	 * You are advised to poll the `isCancelled` function after any async task.
	 * An async task is any of the following:
	 * - When a function is passed as callback, the callback may be invoked in the future.
	 * - After an `await` statement.
	 */
	public wrap<T>(
		fn: (
			isCancelled: IsCancelled,
			resolve: (result: T) => void,
		) => undefined | (() => void),
	): TaskHandle<T> {
		let cleanup: undefined | (() => void) = undefined;

		const promise = new Promise<T>((resolve) => {
			cleanup = fn(this.isCancelled, resolve);
		});

		const wrappedPromise = Object.assign(this.race(promise).finally(cleanup), {
			cancel: this.cancel.bind(this),
			deadline: (ms: number, reason: string) => {
				this.deadline(ms, reason);
				return wrappedPromise;
			},
		});

		return wrappedPromise;
	}

	/**
	 * Wraps a callback in a cancellable promise.
	 *
	 * The callback will be passed a function that polls the cancellation state.
	 *
	 * You are advised to poll the `isCancelled` function after any async task.
	 * An async task is any of the following:
	 * - When a function is passed as callback, the callback may be invoked in the future.
	 * - After an `await` statement.
	 */
	public static wrap<T>(
		fn: (isCancelled: IsCancelled, resolve: (result: T) => void) => () => void,
	): TaskHandle<T> {
		return new Task().wrap(fn);
	}

	/**
	 * Times out the task after a certain amount of time.
	 *
	 * @param ms The amount of time to wait before timing out.
	 */
	public deadline(ms: number, reason: string) {
		if (ms === Number.POSITIVE_INFINITY) return this;
		this.handles.timeout = setTimeout(
			() => this.cancel(`timeout: ${reason}`),
			ms > 0x7fffffff ? 0x7fffffff : ms,
		);
		return this;
	}

	/**
	 * Times out the task after a certain amount of time.
	 *
	 * @param ms The amount of time to wait before timing out.
	 */
	public static deadline(ms: number, reason: string) {
		return new Task().deadline(ms, reason);
	}

	/**
	 * Create a task whose lifetime is scoped by this task.
	 */
	public subtask() {
		const task = new Task();

		this.promise.finally(() => {
			task.cancel(`parent cancelled: ${this.cancelled ?? "finished"}`);
		});

		return task;
	}
}
