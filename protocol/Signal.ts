export const SIGNAL = {
	INIT: 0,
	TERM: 1,
};
/**
 * Match data, returning the separated data on match.
 *
 * @param step Step number to match.
 * @param data Data to match.
 */

export function match(
	step: number | null,
	data: ArrayBuffer,
): { step: number; buffer: ArrayBuffer } | null {
	if (data.byteLength < 4) return null;
	const view = new DataView(data.slice(0, 4));

	if (step === null)
		return { step: view.getUint32(0, true), buffer: data.slice(4) };

	if (view.getUint32(0, true) !== step) return null;

	return { step, buffer: data.slice(4) };
}
/**
 * Brand a message with the step number.
 *
 * @param step Step number to brand with.
 * @param data Data to brand.
 */

export function brand(step: number, data: ArrayBuffer): ArrayBuffer {
	const buffer = new Uint8Array(data.byteLength + 4);
	buffer.set(new Uint8Array(data), 4);

	const view = new DataView(buffer.buffer);
	view.setUint32(0, step, true);

	return buffer.buffer;
}
