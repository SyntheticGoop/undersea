import { router } from "./router";

export * as getGameState from "./getGameState";
export * as setTableSize from "./setTableSize";

export const { clientRouter, serverRouter } = router.finalize();
