import { router } from "./router";

export * as getGameState from "./getGameState";
export * as setTableSize from "./setTableSize";

export const { bindClient, bindServer } = router.finalize();
