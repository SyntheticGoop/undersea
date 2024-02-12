export interface Socket {
	/**
	 * Buffers data to be sent. Sending from buffer happens asynchronously.
	 *
	 * @param data The data to send.
	 */
	send(data: ArrayBuffer): void;

	/**
	 * Receives buffered data. Receiving to buffer happens asynchronously.
	 *
	 * As the socket maintains a data buffer, this function should never be shared between multiple tasks.
	 *
	 * @returns A promise that resolves when data is received.
	 */
	recv(filter: (data: ArrayBuffer) => boolean): Promise<ArrayBuffer>;

	/**
	 * Creates a clone of the socket with a replicated receive buffer.
	 */
	multiplex(): Socket;

	/**
	 * Dispose the resources associated with the socket.
	 *
	 * When a socket is multiplexed, buffers are duplicated across each
	 * multiplexed socket. This resource must be disposed of when no longer needed.
	 *
	 * Calling drop stops this socket from being buffered, but leaves the other
	 * multiplexed sockets unaffected.
	 *
	 * It must not stop sending on the socket unless the final socket is dropped.
	 */
	drop(): void;

	/**
	 * A promise that resolves when the socket is closed.
	 */
	readonly closed: Promise<void>;
}
