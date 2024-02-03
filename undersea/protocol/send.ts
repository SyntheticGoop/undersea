import { brand } from "./Protocol";
import { Socket } from "../lib/Socket";
import { Protocol } from "./Protocol";

/**
 * Sends data on a socket.
 *
 * @param socket Socket to send data on.
 * @param proto Protocol configuration to use.
 * @param data Data to send.
 */
export function send(socket: Socket, proto: Protocol, data: ArrayBuffer) {
	socket.send(brand(proto, data));
}
