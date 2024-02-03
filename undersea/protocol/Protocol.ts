// Protocol spec
//
// |=|=|=|=|=|==>
// | |   |   |
// | |   |   +--- data
// | |   |
// | |   +------- nonce
// | |
// | +----------- key
// |
// +------------- control byte / key

export const PROTOCOL = {
	/**
	 * Open signals that a connection is alive.
	 */
	OPN: 0,
	/**
	 * Signal is used for control messages.
	 */
	SIG: 1,

	/**
	 * Message is used to send data.
	 */
	MSG: 2,
	/**
	 * Acknowledge is used to acknowledge data has been received.
	 */
	ACK: 3,
};
export const PROTOCOL_KEY = new Map<number, keyof typeof PROTOCOL>(
	Object.entries(PROTOCOL).map(([key, value]) => [
		value,
		key as keyof typeof PROTOCOL,
	]),
);

export type Protocol = {
	type: keyof typeof PROTOCOL;
	key: number;
	nonce: number;
};

export function match(
	match: Partial<Protocol>,
	data: ArrayBuffer,
): { proto: Protocol; buffer: ArrayBuffer } | null {
	if (data.byteLength < 5) return null;
	const view = new DataView(data.slice(0, 5));

	const protocolKey = PROTOCOL_KEY.get(view.getUint8(0));

	if (typeof protocolKey === "undefined") return null;

	const proto = {
		type: protocolKey,
		key: view.getUint16(1, false),
		nonce: view.getUint16(3, false),
	};

	if (typeof match.type === "string") {
		if (proto.type !== match.type) return null;
	}

	if (typeof match.key === "number") {
		if (proto.key !== match.key) return null;
	}

	if (typeof match.nonce === "number") {
		if (proto.nonce !== match.nonce) return null;
	}

	return { proto, buffer: data.slice(5) };
}
export function brand(type: Protocol, data: ArrayBuffer): ArrayBuffer {
	const buffer = new Uint8Array(data.byteLength + 5);
	buffer.set(new Uint8Array(data), 5);

	const view = new DataView(buffer.buffer);
	view.setUint8(0, PROTOCOL[type.type]);
	view.setUint16(1, type.key, false);
	view.setUint16(3, type.nonce, false);

	return buffer.buffer;
}
