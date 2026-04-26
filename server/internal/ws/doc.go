// Package ws contains the WebSocket hub for live inventory sync.
//
// Architecture (PR-10, Faz 3):
//
//	Client ──HTTP/Upgrade──> /api/v1/ws (access token in Authorization)
//	   │
//	   └─JSON events──> Hub.Connection (per-user, may have multiple devices)
//	                       │
//	                       └─Hub.Broadcast(event) fan-out to all active conns
//
// Event payload is INTENTIONALLY MINIMAL — just resource_id + type +
// actor_user_id + timestamp. The client must re-fetch via REST to pull
// the actual data, so RBAC re-evaluates on every read. Server-side
// per-user RBAC filtering on the hub is a Faz 5 optimization.
//
// Concurrency model:
//   - Hub.connections is sync.RWMutex-protected
//   - Each Connection has its own send chan (buffered, drops on overflow)
//   - Reader goroutine consumes pings/pongs (no inbound business messages
//     in MVP — events are server-initiated)
//   - Writer goroutine drains the send chan
//   - Closing a connection cancels the per-conn context, both goroutines exit
package ws
