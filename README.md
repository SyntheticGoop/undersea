- [Undersea](#undersea)
  - [Where does this name come from?](#where-does-this-name-come-from)
  - [Why?](#why)
  - [Should I use this?](#should-i-use-this)
  - [Why not \[insert other framework here\]?](#why-not-insert-other-framework-here)
  - [Why did you make this then?](#why-did-you-make-this-then)
  - [Example usage](#example-usage)
        - [Shared API definition](#shared-api-definition)
        - [Route action](#route-action)
        - [Using the route](#using-the-route)
        - [Error handling](#error-handling)
        - [Testing](#testing)
        - [Security](#security)
        - [Reliability](#reliability)
        - [Performance](#performance)
  - [Okay I still want to use this. How do I install it?](#okay-i-still-want-to-use-this-how-do-i-install-it)
        - [Warning on bundling](#warning-on-bundling)
        - [Using with frameworks like `nextjs`](#using-with-frameworks-like-nextjs)
        - [A note on versioning](#a-note-on-versioning)
  - [Technical dive behind the design](#technical-dive-behind-the-design)

# Undersea

Undersea is a framework for building type safe, bidirectional communication between a server and a client.

## Where does this name come from?

The undersea cables that connect the world are the backbone of the internet.

## Why?

Why not.

## Should I use this?

Just because I use this in production doesn't mean you should.

## Why not [insert other framework here]?

Why not? It's a free country.

## Why did you make this then?

Partly as an experiment, but also because I dislike how other frameworks operate.

## Example usage

##### Shared API definition
```ts
import { Router } from "undersea/framework"

export type ServerState; // State shared on the entire server (e.g. database connection pool)
export type ClientState; // State shared on the entire client (e.g. user session)

export type ServerConnectionState; // State shared within a connection (e.g. user session)
export type ClientConnectionState; // State shared within a connection (e.g. server session)

export const { route, finalize } = new Router<ServerState, ClientState, ServerConnectionState, ClientConnectionState>(
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

export const { client, server } = route<
  "client", // To narrow down the generated route type we first specify who is initiating the connection. ("client" or "server")
  "send", // Followed by the kind of route we are defining. ("send", "send stream", "stream", or "duplex")
  DataServerReceives,
  DataClientReceives
>(
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
import { finalize } from "./api"
export * as someApiRoute from "./someApiRoute"
export const { bindServer, bindClient } = finalize()
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

Which handlers you can pick depends on your route definition.

There are two types of routes `recv` and `send` routes.
The `recv` are where the server actions are defined.
The `send` routes are the type safe client bindings to those actions.

The initiating side of the connection will always use `send` routes and the responding side will always use `recv` routes.

In your route definition you will be asked to define who is initiating the connection.
```ts
router.route<"client", _, _, _> // The client is initiating the connection.
router.route<"server", _, _, _> // The server is initiating the connection.
```

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

You will make this choice when you're defining the route.
```ts
router.route<_, "send", _, _> // `asSend` or `asRecv`
router.route<_, "send stream", _, _> // `asSendStream` or `asRecvStream`
router.route<_, "stream", _, _> // `asSendStreamOnly` or `asRecvStreamOnly`
router.route<_, "duplex", _, _> // `asSendStreamDuplex` or `asRecvStreamDuplex`
```

You may write a validation function for the responses to all routes as you may not want to trust the other side of the connection. The exception to this is the `asSendStreamOnly` as it never receives a response.

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

      return someApiRoute.DataClientReceives
    }
  }
)
```

Things are simpler on the client as we only need to present a type safe 
interface to the api route (if it is a `send` route).

__On the client__
```ts

import { someApiRoute } from "./api"

// This creates a function that you may use to call after you've bound the socket.
export const apiRoute = someApiRoute.client.asSend()
```

Note that `send` and `recv` routes are not exclusive to the client or the server.
You can have a `send` route on the server and a `recv` route on the client.
The way these routes are declared on both the server and the client is the same.

##### Using the route

Now that you've finally defined the route, you can use it in your application.

This framework doesn't dictate how you broker and manage the duplex connections, only
that the connections implement the `Socket` interface.

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
import { ServerState, ServerConnectionState } from "./api"
import { apiRoute } from "./server"

// Create a function that will keep the server running.
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
      const socket = new NodeWsWebsocketSocket(
        ws, 
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
      // This api route needs to be bound separately for each connection.
      //
      // It will now begin handling requests to the route.
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
import { ClientState, ClientConnectionState, someApiRoute } from "./api"
import { apiRoute } from "./server"

let socket: BrowserWebsocketSocket;

// Create a function that will keep the socket alive.
async function persistentWebsocketConnection() {
  while (true) {
    const websocket = new WebSocket('wss://your.websocket');

    // Create a new socket for the connection.
    socket = new BrowserWebsocketSocket(
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

// Before use, the api route must be bound to the client.
// Since the client is kept alive you can choose to bind the api route
// once and export it to the rest of your application.
//
// Errors in the binding will be thrown when the route is used.
const api = apiRoute(client);

// This now works.
const response = await api(someApiRoute.DataServerReceives)
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

REST APIs will always allow you to handle more connections as they are short lived.

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
  You should consider that a single server has a finite amount of compute and therefore
  connections it can hold. Implement rate limits to prevent your server from crashing
  and instead scale horizontally.

- Connections are randomly being dropped.
  Check for the following:
  - Do you have enough ack timeout? The more connections you have, the more timeouts you will need.
  - Do you need larger buffers? If the server is slow to respond to a burst of messages, you will need a bigger buffer.
  - Is your connection itself flaky? We do not handle reconnection, retrying failed messages, or any other kind of reliability.

- High memory usage on the client.
  You need to think about how much data you're receiving and how much you're buffering.
  We make sure we free any memory we don't need as soon as possible, so it is likely a fundamental
  design issue.

There are definitely performance improvements that can be made, but I'll need a better understanding
on how memory is handled and how to better schedule tasks in nodejs. We're currently abusing promises to get this to work.

## Okay I still want to use this. How do I install it?

This is currently not published on `npm` because I don't like using it.

Install it directly from github with your relavant package manager. This is supported by `npm`, `yarn`, `pnpm` and `bun`.

Or just clone the repository and use it as a local package.

Note that the framework is located in a subdirectory of the repository.
You will want to import the files from 
```ts
import from "undersea/framework"
import from "undersea/clients/*"
import from "undersea/lib/Socket"
```

Default package exports are a bitch to maintain and I seriously can't be fucked.
Import exactly what you're using from the source code.


##### Warning on bundling

You are required to use a bundler that can compile a `typescript` dependency as
this only ships with `typescript` source files.

Personally I would use `vite-node`, `deno` or `bun` as typescript is handled
natively in these environments.

##### Using with frameworks like `nextjs`

Don't know. Haven't tried it. You're on your own.

##### A note on versioning

We're currently using "whatever the fuck I feel like versioning".

Lock your version to an exact number.

## Technical dive behind the design

I'll write this if I feel like it. You can attempt to read the source but good luck with that.