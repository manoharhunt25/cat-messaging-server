# CAT Messaging: Server

The REST API and real-time (Socket.IO) server for **CAT Messaging**, a team chat app with one-to-one and group conversations. It stores users, chats and messages in MongoDB and handles login with JSON Web Tokens.

The web front end is in **[cat-messaging-client](https://github.com/manoharhunt25/cat-messaging-client)**.

## Tech stack

| Area | Library |
|---|---|
| Runtime | Node.js (18+, tested on Node 26) |
| HTTP API | Express 4 |
| Database | MongoDB via Mongoose 8, for example a free MongoDB Atlas cluster |
| Login | jsonwebtoken (tokens last 30 days), bcryptjs password hashing |
| Real time | Socket.IO 4 |
| Other | cors, dotenv, express-async-handler, colors |

## Getting started

### Prerequisites

- **Node.js 18 or newer**
- A **MongoDB** database. A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster works. In Atlas, create a database user and add your IP address under **Network Access**.

### Install

```bash
git clone https://github.com/manoharhunt25/cat-messaging-server.git
cd cat-messaging-server
npm install
```

### Configure

Settings are read from **`config/.enviro`**, which is ignored by git. Create it from the template:

```bash
cp config/.enviro.example config/.enviro
```

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB connection string, for example `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/catmessaging`. The part after `.net/` is the database name, which MongoDB creates on first use. |
| `JWT_SECRET` | Yes | Any long random string, used to sign login tokens |
| `PORT` | No | Port to listen on, `4000` by default |

> If the password contains `@ : / ? #` or `%`, URL-encode it in `MONGO_URI`, or use a password made of letters and numbers only. Don't wrap it in `< >`.

### Run

```bash
node server.js
```

You should see `Server started on port 4000`, then `MongoDB Connected: …`. Visiting http://localhost:4000 returns `API running successfully`.

## API reference

Base URL: `http://localhost:4000`. Request and response bodies are JSON.

Routes marked 🔒 need an `Authorization: Bearer <token>` header with the token from register or login. Missing or invalid tokens, or a token for a deleted account, get `401`. Malformed IDs get `400`, a missing chat or user gets `404`, and actions you aren't allowed to take get `403`.

### Users: `/api/user`

| Method | Path | Auth | Body / query | Description |
|---|---|---|---|---|
| `POST` | `/api/user` | | `{ name, email, password }` | Register. Returns the user and a `token`. `400` if fields are missing or not text, or the email is taken. |
| `POST` | `/api/user/login` | | `{ email, password }` | Log in. Returns the user and a `token`. `400` if fields are missing or not text, `401` for wrong credentials. |
| `GET` | `/api/user?search=<text>` | 🔒 | | Case-insensitive search by name, matching the text literally. Excludes the caller and returns at most 50 users, with `_id`, `name`, `email` and `pic` only. |

### Chats: `/api/chat`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| `POST` | `/api/chat` | 🔒 | `{ userId }` | Opens the one-to-one chat with that user, creating it if needed. `404` if the user doesn't exist; you can't chat with yourself. |
| `GET` | `/api/chat` | 🔒 | | All chats the caller belongs to, most recently updated first, with members, group admin and latest message filled in. |
| `POST` | `/api/chat/group` | 🔒 | `{ name, users }` | Creates a group. `users` is a **JSON string** array of user IDs; duplicates and the caller are ignored, and at least 2 other existing users are required. The caller is added and becomes admin. |
| `PUT` | `/api/chat/rename` | 🔒 | `{ chatId, chatName }` | Renames a group. **Admin only.** |
| `PUT` | `/api/chat/groupadd` | 🔒 | `{ chatId, userId }` | Adds a member. **Admin only**; the user must exist and not already be in the group. |
| `PUT` | `/api/chat/groupremove` | 🔒 | `{ chatId, userId }` | Removes a member. **The admin can remove anyone; any member can remove themselves** (leave). If the admin leaves, the next member becomes admin. |

Group actions require the caller to be a member of the group; non-members get `403`.

### Messages: `/api/message`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| `POST` | `/api/message` | 🔒 | `{ content, chatId }` | Sends a message and updates the chat's latest message. Returns the message with sender and chat filled in. **Members only.** |
| `GET` | `/api/message/:chatId` | 🔒 | | All messages in a chat, in the order they were saved. **Members only.** |

### Errors

Errors return JSON: `{ "message": "...", "stack": "..." }`. `stack` is `null` when `NODE_ENV=production`. Unknown routes return `404`.

## Real-time events (Socket.IO)

The Socket.IO server runs on the same port. It only accepts connections from **`http://localhost:3000`**: change `origin` in `server.js` when you deploy the client somewhere else.

**Connections must log in** with the same JWT the REST API uses:

```js
const socket = io("http://localhost:4000", { auth: { token } });
```

Connections without a valid token are refused with `Not authorized`. The server identifies the user from the token, and never from anything the client sends in an event.

| Direction | Event | Payload | Purpose |
|---|---|---|---|
| client → server | `setup` | (ignored) | Joins the user's private room, named after their verified ID. The server replies with `connected`. |
| client → server | `join chat` | chat ID | Joins the room for a chat. Ignored unless the user is a member. |
| client → server | `new message` | message (as returned by `POST /api/message`) | Relays a just-sent message to the other members. Only its `_id` is used: the server reloads it from the database, checks the sender is this user, and delivers it to the chat's real members. |
| server → client | `message recieved` | message | A new message for this user. The spelling matches the client code. |

## Data model

| Collection | Fields |
|---|---|
| **User** | `name`, `email` (unique), `password` (bcrypt hash, set by a pre-save hook), `isAdmin` (unused), timestamps |
| **Chat** | `chatName`, `isGroupChat`, `users` → User[], `latestMessage` → Message, `groupAdmin` → User, timestamps |
| **Message** | `sender` → User, `content`, `chat` → Chat, `readBy` → User[] (not used yet), timestamps |

## Project structure

```
server.js                 Express app, routes, error handling, Socket.IO
config/
  nodeCompat.js           Node 25+ compatibility fix, loaded first (see below)
  db.js                   MongoDB connection
  generateToken.js        Creates JWTs (30-day expiry)
  .enviro.example         Template for config/.enviro
Routes/                   userRoutes, chatRoutes, messageRoutes
controllers/              Request handlers for users, chats and messages
middleware/
  authMiddleWare.js       `protect`: checks the Bearer token, sets req.user
  errorMiddleware.js      404 handler and JSON error responses
models/                   Mongoose schemas: User, Chat, Message
data/data.js              Sample data, not used by the server
```

## Notes

### Node.js 25 and later
Node 25 removed `buffer.SlowBuffer`. `jsonwebtoken` still depends on `buffer-equal-constant-time` (through `jws` and `jwa`), which reads it when loaded, so the server crashed on startup. [`config/nodeCompat.js`](config/nodeCompat.js) restores an alias before anything loads `jsonwebtoken`. It does nothing on older Node versions, and can be deleted once that dependency chain is updated.

### Security
The server enforces its rules itself, without relying on the client:
- Only group admins can rename a group or add and remove members; anyone can leave.
- Only members can read or send messages in a chat.
- Socket.IO connections need a valid JWT, and users can only receive their own messages and relay messages they sent.
- User search never returns password hashes, and search text is escaped before it reaches a database regex.
- Login and register only accept plain text fields, which blocks MongoDB query-operator injection.

### Known limitations
- **CORS:** the REST API accepts requests from any origin, while Socket.IO accepts only `http://localhost:3000`. Tighten both for production.
- **No rate limiting** on login or registration.
- **Tokens last 30 days and can't be revoked**; logging out only removes the token in the browser.
- There are no automated tests for the server yet.
