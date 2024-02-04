/**
 * Codec interface.
 */
export type Codec = {
	/**
	 * Encode the data into an ArrayBuffer.
	 *
	 * You must return an ArrayBuffer.
	 */
	encode(data: unknown): ArrayBuffer;
	/**
	 * Decode the data from an ArrayBuffer.
	 *
	 * It is acceptable to throw an error if the data is invalid.
	 */
	decode(data: ArrayBuffer): unknown;
};
