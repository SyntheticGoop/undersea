# undersea

Undersea is a framework for building type safe, bidirectional communication between a server and a client.

## Why?

Why not.

## Should I use this?

Just because I use this in production doesn't mean you should.

## Why not [insert other framework here]?

Why not? It's a free country.

## Why did you make this then?

Partly as an experiment, but also because I dislike how other frameworks operate.

##### Shared API definition
```ts
import { Router } from "undersea/framework"

export type ServerState; // State shared on the entire server (e.g. database connection pool)
export type ClientState; // State shared on the entire client (e.g. user session)

export type ServerConnectionState; // State shared within a connection (e.g. user session)
export type ClientConnectionState; // State shared within a connection (e.g. server session)

export const router = new Router<ServerState, ClientState, ServerConnectionState, ClientConnectionState>(
  // Optional configuration overrides for the router.
  {
    // Encoding and decoding options. Uses binary representation of JSON by default.
    codec: {
      encode: (data: unknown) => ArrayBuffer, // Encode the data to send on the wire
      decode: (data: ArrayBuffer) => unknown, // Decode the data received from the wire
    },
    // Connection options. These options may also be modified on the route itself during creation.
    config: {
      ackDeadline: 5000, // Change how long the server waits for a message ack.
      channelSilentDeadline: 10000, // Change the maximum time between messages from the client before the server considers the connection dead.
      connectSilentDeadline: 10000, // Change the maximum time between messages from the server before the client considers the connection dead.
    }
  }
)
```

You can then define the types of the routes and custom configurations.
You may move these definitions to a separate file.

However, you must import them back before finalizing the router. 

```ts
export type DataServerReceives; // The data the server receives from the client.
export type DataClientReceives; // The data the client receives from the server.

export const { client, server } = router.route<DataServerReceives, DataClientReceives>(
  // This is optional. It will inherit the configuration from the router if not provided.
  {
    ackDeadline: 5000, // Change how long the server waits for a message ack.
    channelSilentDeadline: 10000, // Change the maximum time between messages from the client before the server considers the connection dead.
    connectSilentDeadline: 10000, // Change the maximum time between messages from the server before the client considers the connection dead.
  }
)
```

After defining the route, you can finalize the router to be used.

If you're using separate files for the route definitions, you must import them
before finalizing the router.

```ts
export * as someApiRoute from "./someApiRoute"
export const { bindServer, bindClient } = router.finalize()
```

Since creating a route is a side effect that modifies the router, the import
order is important. 

You should never import directly from the route file. Always re-export your routes
from the main file where you finalize the router to ensure that routes are always
bound in the correct order.

The binding of routes generates a unique route key for the route. It is imperative
that this key is generated the same way on both the server and the client or routes
will mismatch and you will get data errors.

##### Route action

Once your api is defined, you must define the handlers for the server and the client.

There are two types of routes `recv` and `send` routes.
The `recv` are where the server actions are defined.
The `send` routes are the type safe client bindings to those actions.

With these two types of routes there are 4 different variants of routes.

- `asSend` and `asRecv`: These connections are single use and will return one result before closing.
  You should recognize these as traditional request/response routes.

- `asSendStream` and `asRecvStream`: These are long lived streams that can be used to send and receive multiple messages.
  Each message is paired with a response and there can only be one message-response pair in flight at a time.
  These connections are similar to the `asSend` and `asRecv` connections but can be used to maintain state on the server over the duration of the stream.

- `asSendStreamOnly` and `asRecvStreamOnly`: These are long lived streams that can be used to either stream data to or receive streams from the connection.
  As these are connections either do not have a response or a payload, they can be used in situations where you need to stream data without waiting for acknoledgement or a response.

- `asSendStreamDuplex` and `asRecvStreamDuplex`: These are long lived streams that can be used to send and receive streams from the connection.
  These function as a combination of `asSendStreamOnly` and `asRecvStreamOnly`, allowing a two way stream of data that does not wait on either side for a response.

You may a validation function for the responses to all routes as you may not want to trust the other side of the connection. The exception to this is the `asSendStreamOnly` as it never receives a response.

Additionally, for all `stream` type connections, you must set a buffer size.
If the buffer is full:
- The `send` side will not be allowed to send any more messages.
- The `recv` side will immediately drop the connection.

This is to prevent the server from being overwhelmed and the client from flooding the server.
Having buffers set too large can leave your server open to a DoS attack that forces you to run out of memory.

Be judicious with your buffer sizes as having large buffers will cost more memory allocations and trigger more garbage collection.

__On the server__
```ts
import { someApiRoute } from "./api"

function validator(data: unknown): data is someApiRoute.DataServerReceives {
  // Your validation logic here
  return true
}


export const apiRoute = someApiRoute.server.asRecv(
  () => {
    // Server routes are intended to be spawned repeatedly, therefore you must
    // return a factory function to create a new handler for each time the route
    // is called.

    // It is completely valid for a connection to make multiple connection attempts.

    // The handlers can have closures over the state generated inside the factory function.
    // This is useful for when managing state of long lived streams.

    const streamSharedState = 0;

    return async function handler(
      // The data payload into the route.
      data: someApiRoute.DataServerReceives,
      // The context of the route.
      context: {
        // The application wide state.
        app: ServerState,
        // The connection specific state.
        connection: ServerConnectionState,
        // The task that is being executed in.
        // You can use this to abort the entire route.
        task: Task
      }
    ): someApiRoute.DataClientReceives {
      // Your server logic here.
      // You must never throw an error.
      // Use the task to abort the route if necessary.
      streamSharedState++

      return null as someApiRoute.DataClientReceives
    }
  }
)

```

Things are simpler on the client as there is only one connection to manage.

__On the client__
```ts

import { someApiRoute } from "./api"

export const apiRoute = someApiRoute.client.asSend()

```

Note that `send` and `recv` routes are not exclusive to the client or the server.
You can have a `send` route on the server and a `recv` route on the client.

Another gotcha when defining routes is accidentally pairing up the wrong `send` and `recv` types.
For example, pairing a `asSend` with a `asRecvStream` may look like it's working,
but you're effectively creating many open streams that eventually timeout.

##### Using the route

Now that you've finally defined the route, you can use it in your application.

The route doesn't dictate how you broker and manage the duplex connections, only
the connections implement the `Socket` interface.

This interface can be found in `lib/Socket.ts`.

We have provided 3 implementations that you can use or extend from.
These are found in `lib/clients/*`
- `BrowserWebsocketSocket` that implements a socket for a browser `WebSocket` connection.
- `NodeWsWebsocketSocket` that implements a socket for the nodejs `ws` library.
- `VirtualSocket` that implements an in-memory socket. The other socket implementations extend from this.

You can also implement your own socket by extending the `Socket` interface.
Use whatever you want. You can even use a long polling connection for sockets.

Here's how you might set up the api using the sockets provided.

__On the server__
```ts
import { WebSocketServer } from "ws";
import { NodeWsWebsocketSocket } from "undersea/clients/NodeWsWebsocketSocket";
import { apiRoute } from "./server"

async function createServerWebsocketConnection() {
	while (true) {
		const server = new WebSocketServer({ port: 54321 });

		await new Promise((up) => {
			server.on("listening", up);
		});

    // When a new client connects, you must spawn an entire new socket and api
    // for that connection.
    //
    // This is because the api is stateful.
		server.on("connection", async (ws) => {

      // Create a new socket for the connection.
			const socket = new NodeWsWebsocketSocket(ws, 
        // You must set up how many messages the api is allowed to buffer.
        // Be judicious with this limit. You do not need nearly as many buffered
        // messages as you think you do.
        { in: 100, out: 100 }
      );

      // Create bindings for the server.
      //
      // When creating bindings, what we're doing is essentially
      // providing the various runtime contexts to the api that
      // we could not otherwise statically provide.
			const server = bindServer(
        ServerState,
        async () => ({
          connection: ServerConnectionState,
          socket 
        })
      );

      // Bind the api route to the server.
      apiRoute(server);
		});

		await new Promise((ok) => {
			server.on("close", ok);
		});
	}
}

createServerWebsocketConnection();
```

__On the client__
```ts
import { BrowserWebsocketSocket } from "undersea/clients/BrowserWebsocketSocket";
import { apiRoute } from "./server"

let socket: BrowserWebsocketSocket;

async function persistentWebsocketConnection() {
  while (true) {
    const websocket = new WebSocket('wss://your.websocket');

    // Create a new socket for the connection.
    socket = new BrowserWsWebsocketSocket(
      websocket, 
      // You must set up how many messages the api is allowed to buffer.
      // Be judicious with this limit. You do not need nearly as many buffered
      // messages as you think you do.
      { in: 100, out: 100 }
    );

    await new Promise((close) => websocket.addEventListener("close", close););
  }
}

persistentWebsocketConnection();

// Create bindings for the client.
//
// When creating bindings, what we're doing is essentially
// providing the various runtime contexts to the api that
// we could not otherwise statically provide.
const client = bindClient(
  ClientState,
  async () => ({
    connection: ClientConnectionState,
    socket 
  })
)

const api = apiRoute(client);

await api(someApiRoute.DataServerReceives)
```

##### Error handling

Throwing an error inside an API route is undefined behavior.

Always use errors as values if you need errors.

You may cancel and route on the server by using the `task` object passed to the handler.

##### Testing

There is no way to test that things work now.
I don't even know how to go about doing that.

##### Security

Rate limiting and bandwidth throttling is not implemented here yet.

That means a rogue client can potentially flood your server with requests and
take it down.

You are advised to implement your own rate limiting before binding to the api route.

To prevent a single client flooding the server, you should limit the buffer sizes
of the api routes. In most cases you should not need more than a buffer size of 1 if
the client is engineered to correctly wait. Unidirectional streams might require larger buffers.

You may want to implement rate limiting by providing a connection rate limiter for each client
in the connection state. You can then consume this inside the api routes to pause the
route if the client is sending too many requests.

##### Reliability

Some testing has been done, but not enough to say that this is reliable.

##### Performance

The million dollar question eh?

Realistically, this is not going to be very fast or handle a lot of connections.

You still have to make engineering decisions on how you use this framework.

Here are the limits you may run into, depending on your use case:

- You run out of memory and node crashes. If your application holds a lot of state
  per connection, it is likely you will run out of memory very quickly.
  Make sure you are not holding onto state that you don't need so that the garbage
  collector can clean up after you.
  This may also be a fundamental limitation of your application and nothing is going to
  save you even if you use a different framework.
  You should consider that a single server has a finite amount of memory and therefore
  connections it can hold. Implement rate limits to prevent your server from crashing
  and instead scale horizontally.

- The server is slow to respond and is extremely laggy.
  You may not have reached your memory limit, but there are simply too many concurrent
  requests for the server to handle.
  In contrast to a REST API, this framework will maintain an active connection for each client.
  each connection will bind relavant event handlers for each route.
  This is significantly more overhead than a REST API which can dispose of all state after each request.
  For example you may have 1000 clients connecting to the server in a round robin fashion with regular REST requests.
  The requests can be handled one at a time with ease.
  Contrast with this, 1000 clients will maintain 1000 active connections to the server at all times.
  These connections will take up memory and CPU time to maintain all the relevant listeners for.