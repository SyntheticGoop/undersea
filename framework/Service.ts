export type Service<InternalKnown, ExternalRaw> = {
	/**
	 * Verifies external raw to be of the correct type.
	 *
	 * @param externalRaw Unknown data to verify.
	 */
	validate(externalRaw: unknown): boolean;
	/**
	 * Buffers external data.
	 */
	external(data: ExternalRaw): boolean;
	/**
	 * Requests internal data.
	 */
	internal(): Promise<InternalKnown | null> | null;

	/**
	 * Take external raw data.
	 */
	takeExternal(): Promise<ExternalRaw>;

	/**
	 * Send known internal data.
	 */
	loadInternal(payload: InternalKnown | null): boolean;
};
