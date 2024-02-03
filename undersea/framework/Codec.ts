export type Codec = {
	encode(data: unknown): ArrayBuffer;
	decode(data: ArrayBuffer): unknown;
};
