import { router } from "./router";

export type TableSize = {
	width: number;
	height: number;
};
export const { client, server } = router.route<
	"client stream",
	TableSize,
	null
>();
