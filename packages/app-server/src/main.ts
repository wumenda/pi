import { createAppServer } from "./index.ts";

const handle = createAppServer({ wsPort: Number(process.env.APP_SERVER_WS_PORT ?? 8790) });
await handle.start();
console.log("app-server ready");
console.log(`  serverId: ${handle.serverId}`);
console.log(`  wsUrl:    ws://127.0.0.1:${handle.wsPort}`);
