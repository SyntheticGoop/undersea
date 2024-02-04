export type Config = {
	/**
	 * The maximum time to wait for an ack before disconnecting.
	 */
	ackDeadline: number;
	/**
	 * The maximum time to wait for a response on the server before disconnecting.
	 */
	clientSilentDeadline: number;
	/**
	 * The maximum time to wait for a message on the client before disconnecting.
	 */
	serverSilentDeadline: number;
};
