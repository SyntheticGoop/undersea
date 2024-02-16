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

This example is kept in sync with [example.ts](./example.ts).

### Shared API definition

To start with, you must create a router.

The router is used to register routes and create the bindings for the server and the client.

```ts
import { Router } from "undersea/framework"

export const router = new Router(
  // Optional configuration overrides for the router.
  {
    // Override the default codec.
    //
    // The default codec converts the object to JSON and then represents it as a UTF-8 ArrayBuffer.
    codec: {
      // Encode the data into an ArrayBuffer.
      //
      // You must return an ArrayBuffer.
      encode: (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).buffer,
      // Decode the data from an ArrayBuffer.
      //
      // It is acceptable to throw an error if the data is invalid.
      decode: (data: ArrayBuffer) => JSON.parse(new TextDecoder().decode(data)),
    },
    // Override the default config.
    //
    // Times in milliseconds.
    config: {
      // The maximum time to wait for an ack before disconnecting.
      ackDeadline: 5000, 
      // The maximum time to wait for a response on the server before disconnecting.
      channelSilentDeadline: 30000, 
      // The maximum time to wait for a message on the client before disconnecting.
      connectSilentDeadline: 30000, 
    }
  }
)
```

__Route definition__

You can then define the types of the routes and custom configurations.
You may move these definitions to a separate file.

There are two types of routes `recv` and `send` routes.
The `recv` are where the server actions are defined.
The `send` routes are the type safe client bindings to those actions.

The initiating side of the connection will always use `send` routes and the responding side will always use `recv` routes.

In your route definition you will be asked to define who is initiating the connection.
```ts
router.routeClient...() // The client is initiating the connection.
router.routeServer...() // The server is initiating the connection.
```

With these two types of routes there are 5 different variants of routes.

- `asSend` and `asRecv`: These connections are single use and will return one result before closing.
  You should recognize these as traditional request/response routes.

- `asSendChannel` and `asRecvChannel`: These are long lived streams that can be used to send and receive multiple messages.
  Each message is paired with a response and there can only be one message-response pair in flight at a time.
  These connections are similar to the `asSend` and `asRecv` connections but can be used to maintain state on the server over the duration of the stream.

- `asSendStream` and `asRecvStream`: These are long lived streams that can be used to stream data to the connection.
  As these are connections do not have a response, they can be used in situations where you need to stream data without waiting for acknoledgement or a response.

- `asSendListen` and `asRecvListen`: These are long lived streams that can be used to receive streams from the connection.
  These are intended to be used in situations where you need to stream data in response to an initiating payload.
  As these are connections do not have subsequent sends, they can be used in situations where you need to stream data without waiting for further input.

- `asSendDuplex` and `asRecvDuplex`: These are long lived streams that can be used to send and receive streams from the connection.
  These function as a combination of `asSendStream` and `asRecvStream`, allowing a two way stream of data that does not wait on either side for a response.

You will make this choice when you're defining the route.
```ts
router.route...Send           // `asSend` or `asRecv`
router.route...SendChannel    // `asSendChannel` or `asRecvChannel`
router.route...SendStream     // `asSendStream` or `asRecvStream`
router.route...SendListen     // `asSendListen` or `asRecvListen`
router.route...SendDuplex     // `asSendDuplex` or `asRecvDuplex`
```


```ts
// Declare unique routes.
//
// This is unwieldy, but it has to be done so that we can efficiently
// and stably bind routes to the router.
//
// As this is a side effect, you must ensure that the declarations are
// never removed or reordered unless you are prepared for route with older clients.
//
// Always append new routes to the end of the list.
//
// You are recommended to use not give your routes names that have any significance
// in order to reduce the meaningfulness of these route declarations.
//
// To narrow down the generated route type we first specify who is initiating the connection. ("client" or "server")
// Followed by the kind of route we are defining. ("send", "send stream", "stream", or "duplex")
const route0001 = router.routeClientSend();
const route0002 = router.routeClientSendStream();
// The connection does not need to be initiated by the client.
const route0003 = router.routeServerSendStreamOnly();
const route0004 = router.routeClientSendDuplex();
const route0005 = router.routeClientSendListen();

// Define routes
type MultiplySend = { a: number; b: number };
type MultiplyRecv = { result: number };
const multiplyRoute = route0001.define<
  // The data that is sent to the server.
  MultiplySend,
  // The data that is received from the server.
  MultiplyRecv
>();

type ToStringSend = { value: number };
type ToStringRecv = { result: string };
const toStringRoute = route0002.define<ToStringSend, ToStringRecv>();

type TailLogsRecv = { logs: string[] };
const tailLogsRoute = route0003.define<
  // The order of what is sent and what is received changes depending on who initiates the connection.
  TailLogsRecv,
  // In a non send stream one side does not send data.
  null
>({
  serverSilentDeadline: Number.POSITIVE_INFINITY,
});

type EventStreamSend = { value: string[] };
type EventStreamRecv = { value: string[] };
const eventStreamRoute = route0004.define<EventStreamSend, EventStreamRecv>();

type StreamListenSend = { value: number };
type StreamListenRecv = { value: number };
const fibbonaciGeneratorRoute = route0005.define<
  StreamListenSend,
  StreamListenRecv
>();
```

Since creating a route is a side effect that modifies the router the order of
declaration is important and should remain stable.

Each `.route...()` declaration registers a unique key for the route.
If you reorder or remove these declarations, you will break the bindings for the router.
This is okay if you have a way of refreshing all the clients to the new routes.

Now you can extract the router to be used separately on the server and the client.

```ts
const { serverRouter, clientRouter } = router();
```

### Route action

Once your api is defined, you must define the handlers for the server and the client.

Which handlers you can pick depends on your route definition.

You may write a validation function for the responses to all routes as you may not want to trust the other side of the connection. The exception to this is the `asSendStream` as it never receives a response.

Additionally, for all `stream` type connections, you must set a buffer size.
If the buffer is full:
- The `send` side will not be allowed to send any more messages.
- The `recv` side will immediately drop the connection.

This is to prevent the server from being overwhelmed and the client from flooding the server.
Having buffers set too large can leave your server open to a DoS attack that forces you to run out of memory.

Be judicious with your buffer sizes as having large buffers will cost more memory allocations and trigger more garbage collection.

__On the server__
```ts
// Type guard for the multiply route.
function validateMultiplySend(data: unknown): data is MultiplySend {
  return (
    typeof data === "object" &&
    data !== null &&
    "a" in data &&
    "b" in data &&
    typeof data.a === "number" &&
    typeof data.b === "number"
  );
}

const serverMultiplyRoute = multiplyRoute.server.asRecv(
  // The action to take when the route is called.
  async (data) => ({ result: data.a * data.b }),
  // Validate the data sent to the server.
  //
  // This is optional, but you probably want to do this if your route is on the server.
  // It's probably fine to omit this on the client.
  validateMultiplySend,
);

const serverToStringRoute = toStringRoute.server.asRecvChannel(
  // The action to take when the route is called.
  //
  // Stream routes are intended to be spawned repeatedly, therefore you must
  // return a factory function to create a new handler for each time the route
  // is called.
  //
  // It is completely valid for a connection to make multiple connection attempts.
  //
  // The handlers can have closures over the state generated inside the factory function.
  // This is useful for when managing state of long lived streams.
  () => {
    let accumulator = 0;
    return async (data, context) => {
      if (accumulator > 0xffff) {
        context.task.cancel("overflow");
      }
      accumulator += data.value;
      return { result: accumulator.toString() };
    };
  },
  // In all streams, you must provide a buffer size.
  //
  // The size of the buffer in send-recv streams will determine the maximum number
  // of tasks that can be queued before deferring to the main buffer.
  //
  // The order of replies is guaranteed. The buffered tasks will be processed in series.
  //
  // If the buffer is full, buffering will be deferred to the main buffer.
  // If that is full, messages will be lost and the connection will be terminated.
  10,
);

// For this route, the client will act as the receiver and the server will act as the sender.
const serverTailLogsRoute = tailLogsRoute.server.asSendStream(10);

// Duplex routes are by far the most complex to implement.
//
// This is because they have bidirectional streams that aren't dependent on each other.
//
// In the context of a server you will have to implement both the send and recv streams
// as handlers within a factory function.
const serverEventStreamRoute = eventStreamRoute.server
  // You can require that a route be bound with a specific app state.
  //
  // This app state must be injected later when the route is bound to the router.
  .withApp<{ db: { logs: Map<number, [number, string]> } }>()

  // You can require that a route be bound with a specific connection state.
  //
  // This connection state must be injected later when the route is bound to the router.
  .withConnection<{ sessionId: number }>()
  .asRecvDuplex(
    () => {
      let latestLogId = 0;
      const clientLogs = new Set<number>();

      return {
        async send(send, context) {
          while (true && typeof context.task.isCancelled() !== "string") {
            const logs: string[] = [];
            for (const [id, [clientId, log]] of context.app.db.logs) {
              if (id <= latestLogId || clientLogs.has(clientId)) {
                continue;
              }
              logs.push(log);
            }

            if (send({ value: logs })) {
              latestLogId = context.app.db.logs.size;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        },

        recv(data, context) {
          const key = context.app.db.logs.size;

          for (const log of data.value) {
            context.app.db.logs.set(key, [context.connection.sessionId, log]);

            clientLogs.add(key);
          }
        },
      };
    },
    // Unlike send-recv streams, both the send and recv actions advance in parallel with each other.
    //
    // The `send` and `recv` queues are guaranteed to be processed independently in order.
    {
      send: 100,
      recv: 10,
    },
  );

// This route demonstrates a stream based on an initial request.
const serverFibbonaciGeneratorRoute =
  fibbonaciGeneratorRoute.server.asRecvListen(
    () => ({
      recv(init, send) {
        let a = init.value;
        let b = init.value;

        for (let i = 0; i < 10; i++) {
          send({ value: a });
          [a, b] = [b, a + b];
        }
      },
    }),
    // The buffer size for the listen route is the maximum number of responses that can be queued.
    10,
  );
```

Things are simpler on the client as we only need to present a type safe 
interface to the api route (if it is a `send` route).

__On the client__
```ts
// Set up client routes.
const clientMultiplyRoute = multiplyRoute.client.asSend();
const clientToStringRoute = toStringRoute.client.asSendChannel(1);
// When you invert the sending direction, the role of client and server inverts.
//
// That means you must register event handlers as if the client were a server.
//
// This is because, while unlikely, it is completely valid for the server to
// initiate multiple streams to the client.
const clientTailLogsRoute = tailLogsRoute.client
  .withApp<{ db: { logs: string[] } }>()
  .asRecvStream(
    () => (data, context) => context.app.db.logs.push(...data.logs),
    1,
  );

const clientEventStreamRoute = eventStreamRoute.client
  .withApp<{ db: { logs: string[] } }>()
  .asSendDuplex({
    send: 1,
    recv: 10,
  });

const clientFibbonaciGeneratorRoute =
  fibbonaciGeneratorRoute.client.asSendListen(1);
```

### Using the route

Now that you've finally defined the route, you can use it in your application.

Getting to this point may have seemed like a lot of work, but extreme care has
been taken to ensure that you have full control over what you're doing with a
minimal API surface.

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
        { in: 100, out: 100 },
      );

      // Create bindings for the server.
      //
      // When creating bindings, what we're doing is essentially
      // providing the various runtime contexts to the api that
      // we could not otherwise statically provide.
      const server = serverRouter()
        // If our route requires a specific app state, we must provide it here
        // or typescript will complain.
        //
        // If no app state is required, you can skip this.
        .withApp({ db: { logs: new Map<number, [number, string]>() } })
        .withConnection(async () => ({
          // We need to always provide the connection socket.
          socket,
          // If our route requires a specific connection state, we must provide it here
          // or typescript will complain.
          connection: { sessionId: Math.floor(Math.random() * 0xffff) },
        }))
        // Finally you can bind your recv routes.
        //
        // While it might seem unwieldy to have to manually bind each route,
        // this library is intended to work without any special compiler macro magic.
        //
        // If you're adventurous, you can write your own compiler to do this,
        // but shipping that as a core feature is not something this library is concerned with.
        //
        // The routes provided are dynamically checked at runtime to ensure that all
        // created routes are bound without duplicates.
        .withRoutes(
          serverMultiplyRoute,
          serverToStringRoute,
          serverEventStreamRoute,
          serverFibbonaciGeneratorRoute,
        )
        // Start the server.
        .start();

      // Send routes are handled differently.
      // You need to first provide the create server client from the server router
      // to the send route.
      //
      // The actions you call on the send routes will then be sent down that client.
      if (
        !serverTailLogsRoute
          .connect(server)
          .send({ logs: ["log 1", "log 2"] })
      ) {
        console.error("Failed to send logs");
      }
    });

    await new Promise((ok) => {
      server.on("close", ok);
    });
  }
}

// Start the server.
createServerWebsocketConnection();
```

__On the client__
```ts
import { BrowserWebsocketSocket } from "undersea/clients/BrowserWebsocketSocket";

// We now do the same thing for the client.
let socket: BrowserWebsocketSocket;

// Create a function that will keep the a websocket socket alive.
async function persistentWebsocketConnection() {
  while (true) {
    const websocket = new WebSocket("wss://your.websocket");

    // Create a new socket for the connection.
    socket = new BrowserWebsocketSocket(
      websocket,
      // You must set up how many messages the api is allowed to buffer.
      // Be judicious with this limit. You do not need nearly as many buffered
      // messages as you think you do.
      { in: 100, out: 100 },
    );

    await new Promise((close) => websocket.addEventListener("close", close));
  }
}

persistentWebsocketConnection();

// Unlike the on the server, we aren't managing multiple connections.
// A client only (usually) has one connection.
//
// You need to instead, we create a client object that we pass around to
// dynamically bind routes to.
const client = clientRouter()
  // Again you must provide the app state if a route requires it.
  //
  // You will get a type error if you miss this when required.
  .withApp({ db: { logs: [] } })
  .withConnection(() => Promise.resolve({ socket }))
  .withRoutes(
    // Here we need to bind the client tail logs route.
    //
    // This is because the client is acting as the server for this route.
    clientTailLogsRoute,
  )
  // Start the router in dynamic mode,
  // allowing late binding of routes.
  .start();

// Send routes may fail to send if the buffer is full or the connection is closed.
try {
  const { result } = await clientMultiplyRoute.connect(client).send({
    a: 10,
    b: 100,
  });
  console.log(result)
} catch {
  console.log("Failed to send");
}

// Send stream routes create a server side context, so you cannot immediately
// bind and invoke them in a loop.
const toStringRouteInstance = clientToStringRoute.connect(client);
// Send stream routes may fail to send if the buffer is full or the connection is closed.
for (let value = 0; value < 10; value++) {
  try {
    const { result } = await toStringRouteInstance.send({ value });
    console.log(result)
  } catch {
    console.log("Failed to send");
  }
}

// Duplex routes provide send methods and recv callbacks.
const eventStream = clientEventStreamRoute.connect(client);
const logs: string[] = [];

// Recv callbacks must be bound before the send method is called.
eventStream.recv((data, context) => {
  context.app.db.logs.push(...data.value);
  logs.push(...data.value);
});

// Like other routes, sends may fail if the buffer is full or the connection is closed.
//
// Unlike other routes, duplex connections don't provide a response.
if (!eventStream.send({ value: ["log 1", "log 2"] })) {
  console.log("Failed to send");
}

// Once you are done with a connection, you must dispose of it.
//
// This is not automatically done for you.
eventStream.drop();

// Listen routes creates a stream based on an initial request.
const fibbonaciGenerator = clientFibbonaciGeneratorRoute
  .connect(client)
  .recv({ value: 1 }, console.log);

// Once you are done with a connection, you must dispose of it.
fibbonaciGenerator.drop();
```

### Error handling

Throwing an error inside an API route is undefined behavior.

Always use errors as values if you need errors.

You may cancel and route on the server by using the `task` object passed to the handler.

### Testing

There is no way to test that things work now.
I don't even know how to go about doing that.

### Security

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

### Reliability

Some testing has been done, but not enough to say that this is reliable.

### Performance

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
import {} from "undersea/framework"
import {} from "undersea/clients/*"
import {} from "undersea/lib/Socket"
```

Default package exports are a bitch to maintain and I seriously can't be fucked.
Import exactly what you're using from the source code.


### Warning on bundling

You are required to use a bundler that can compile a `typescript` dependency as
this only ships with `typescript` source files.

Personally I would use `vite-node`, `deno` or `bun` as typescript is handled
natively in these environments.

### Using with frameworks like `nextjs`

Don't know. Haven't tried it. You're on your own.

### A note on versioning

We're currently using "whatever the fuck I feel like versioning".

Lock your version to an exact number.

## Technical dive behind the design

I'll write this if I feel like it. You can attempt to read the source but good luck with that.